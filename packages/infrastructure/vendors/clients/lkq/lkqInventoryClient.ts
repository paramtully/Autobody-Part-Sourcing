/**
 * LKQ Corporation inventory client.
 *
 * Implements VendorInventoryClient for LKQ's REST API.
 *
 * Integration profile:
 * - Auth: API Key + HMAC-SHA256 signature
 * - Pagination: Cursor-based, up to 500 records per page
 * - Rate limit: ~200 req/min, returns Retry-After header on 429
 * - Key behavior: Returns 200 OK with empty listings[] for discontinued parts
 * - Inactive signal: Listings disappear without explicit deactivation
 *
 * Responsibilities (per VendorInventoryClient contract):
 * - Fetch and paginate inventory data
 * - Handle authentication (HMAC signing)
 * - Handle vendor-specific error responses
 * - Normalize transport-level data only (HTTP -> JSON)
 *
 * Does NOT: write to DB, deduplicate, compute hashes, map to domain models.
 */

import { createHmac } from 'crypto';
import type { VendorInventoryClient, UnknownRawVendorRecord, VendorClientError } from '../../inventoryClient';
import type { HttpTransport } from '../shared/httpTransport';
import type { VendorClientConfig, ApiKeyHmacCredentials } from '../shared/vendorClientConfig';
import { lkqPageResponseSchema } from './lkqResponseSchema';

/** Default page size for LKQ inventory requests. */
const DEFAULT_PAGE_SIZE = 500;

/**
 * LKQ Corporation inventory client.
 *
 * Fetches recycled and aftermarket parts from LKQ's REST API.
 * Designed to work with or without the retry decorator --
 * the client itself has no retry logic.
 */
export class LKQInventoryClient implements VendorInventoryClient {
  private readonly credentials: ApiKeyHmacCredentials;

  constructor(
    private readonly config: VendorClientConfig,
    private readonly transport: HttpTransport
  ) {
    if (config.credentials.type !== 'API_KEY_HMAC') {
      throw new Error(
        `LKQInventoryClient requires API_KEY_HMAC credentials, got "${config.credentials.type}"`
      );
    }
    this.credentials = config.credentials;
  }

  /**
   * Stream inventory records from LKQ API.
   *
   * Iterates through all pages, yielding individual records.
   * Memory-efficient for large catalogs (LKQ has 100K+ parts).
   */
  async *fetchInventoryStream(params?: {
    cursor?: string;
    batchSize?: number;
  }): AsyncIterable<UnknownRawVendorRecord> {
    let cursor = params?.cursor;
    let hasMore = true;

    while (hasMore) {
      const page = await this.fetchInventoryPage(cursor);
      for (const record of page.records) {
        yield record;
      }
      cursor = page.nextCursor;
      hasMore = page.hasMore;
    }
  }

  /**
   * Fetch a single page of inventory from LKQ API.
   *
   * Returns cursor-based paginated results. The cursor is an opaque
   * base64-encoded string provided by LKQ's API.
   *
   * Handles LKQ-specific behavior:
   * - 200 OK with empty listings[] = no data (not an error)
   * - 429 = rate limited (throws retryable error with Retry-After)
   * - 401/403 = auth failure (throws non-retryable error)
   * - 5xx = server error (throws retryable error)
   */
  async fetchInventoryPage(cursor?: string): Promise<{
    records: UnknownRawVendorRecord[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const timestamp = Date.now().toString();
    const queryString = `cursor=${encodeURIComponent(cursor ?? '')}&limit=${DEFAULT_PAGE_SIZE}`;
    const signature = this.computeHmac(timestamp, queryString);

    const url = `${this.config.baseUrl}/listings?${queryString}`;
    const response = await this.transport.get(url, {
      'X-Api-Key': this.credentials.apiKey,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'Accept': 'application/json',
    });

    // Handle non-200 responses
    if (response.status !== 200) {
      this.throwVendorError(response.status, response.headers, response.rawBody);
    }

    // Validate response against LKQ-specific schema
    const parsed = lkqPageResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      const error: VendorClientError = {
        type: 'VALIDATION_ERROR',
        message: `LKQ response validation failed: ${parsed.error.message}`,
        vendorId: this.config.vendorId,
        correlationId: this.extractRequestId(response.body) ?? 'unknown',
      };
      throw error;
    }

    // LKQ returns 200 OK with empty listings for discontinued/sold parts.
    // This is valid vendor behavior, not an error.
    return {
      records: parsed.data.listings as UnknownRawVendorRecord[],
      nextCursor: parsed.data.nextCursor,
      hasMore: parsed.data.hasMore,
    };
  }

  /**
   * Health check for LKQ API.
   *
   * Performs a lightweight request to verify API availability
   * and measures response latency.
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    latencyMs: number;
    lastSuccessAt?: Date;
    error?: string;
  }> {
    const start = Date.now();
    try {
      const timestamp = Date.now().toString();
      const signature = this.computeHmac(timestamp, 'limit=1');

      const response = await this.transport.get(
        `${this.config.baseUrl}/listings?limit=1`,
        {
          'X-Api-Key': this.credentials.apiKey,
          'X-Timestamp': timestamp,
          'X-Signature': signature,
          'Accept': 'application/json',
        }
      );

      const latencyMs = Date.now() - start;

      if (response.status === 200) {
        return {
          status: latencyMs > 5000 ? 'degraded' : 'healthy',
          latencyMs,
          lastSuccessAt: new Date(),
        };
      }

      return {
        status: response.status === 429 ? 'degraded' : 'down',
        latencyMs,
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * LKQ vendor capability metadata.
   */
  getVendorCapabilities(): {
    supportsStreaming: boolean;
    supportsRealtimeLookup: boolean;
    supportsImages: boolean;
    supportsFitment: boolean;
    supportsBulkPagination: boolean;
    expectedUpdateFrequencyMinutes: number;
    maxRecordsPerRequest: number;
    rateLimitRequestsPerMinute: number;
  } {
    return {
      supportsStreaming: true,
      supportsRealtimeLookup: false,
      supportsImages: true,
      supportsFitment: true,
      supportsBulkPagination: true,
      expectedUpdateFrequencyMinutes: 60,
      maxRecordsPerRequest: DEFAULT_PAGE_SIZE,
      rateLimitRequestsPerMinute: this.config.rateLimitPerMinute,
    };
  }

  /**
   * Compute HMAC-SHA256 signature for request authentication.
   *
   * Signature = HMAC-SHA256(apiSecret, timestamp + body)
   */
  private computeHmac(timestamp: string, body: string): string {
    return createHmac('sha256', this.credentials.apiSecret)
      .update(timestamp + body)
      .digest('hex');
  }

  /**
   * Extract LKQ request ID from response body for error correlation.
   */
  private extractRequestId(body: unknown): string | undefined {
    if (body && typeof body === 'object' && 'requestId' in body) {
      const val = (body as Record<string, unknown>).requestId;
      return typeof val === 'string' ? val : undefined;
    }
    return undefined;
  }

  /**
   * Throw a structured VendorClientError for non-200 responses.
   *
   * Error classification:
   * - 429 -> RATE_LIMIT (retryable)
   * - 401/403 -> AUTH_ERROR (non-retryable)
   * - 400 -> INVALID_REQUEST (non-retryable)
   * - 5xx -> SERVER_ERROR (retryable)
   */
  private throwVendorError(status: number, headers: Record<string, string>, rawBody: string): never {
    let errorType: VendorClientError['type'];
    if (status === 429) {
      errorType = 'RATE_LIMIT';
    } else if (status === 401 || status === 403) {
      errorType = 'AUTH_ERROR';
    } else if (status === 400) {
      errorType = 'INVALID_REQUEST';
    } else if (status >= 500) {
      errorType = 'SERVER_ERROR';
    } else {
      errorType = 'SERVER_ERROR';
    }

    const error: VendorClientError = {
      type: errorType,
      message: `LKQ API returned HTTP ${status}: ${rawBody.substring(0, 200)}`,
      vendorId: this.config.vendorId,
      correlationId: headers['x-request-id'] ?? 'unknown',
      retryAfterMs: this.parseRetryAfterHeader(headers),
    };

    // Attach status to the error object for retry utility classification
    const throwable = new Error(error.message);
    Object.assign(throwable, { status, ...error });
    throw throwable;
  }

  /**
   * Parse Retry-After header from response headers.
   * Returns milliseconds to wait, or undefined if header not present.
   */
  private parseRetryAfterHeader(headers: Record<string, string>): number | undefined {
    const retryAfter = headers['retry-after'];
    if (!retryAfter) return undefined;

    const seconds = Number.parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    return undefined;
  }
}
