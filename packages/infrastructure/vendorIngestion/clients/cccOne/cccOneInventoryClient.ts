/**
 * CCC One inventory client.
 *
 * Implements VendorInventoryClient for CCC One's REST API.
 *
 * Integration profile:
 * - Auth: OAuth 2.0 client_credentials + optional mTLS
 * - Pagination: None (single-part lookups)
 * - Rate limit: 50-1000 req/day depending on tier (strict)
 * - Key behavior: Returns OEM, aftermarket, and recycled alternatives in one response
 * - Prices are estimates, not real-time inventory
 * - Data can be stale (up to 1 week, via X-Cache-Age header)
 *
 * Design differences from LKQ:
 * - No bulk pagination: CCC is queried per-part, not per-page
 * - Lower confidence scoring: estimates vs real inventory
 * - Auth token lifecycle managed by separate CccOneAuthProvider
 *
 * Does NOT: write to DB, deduplicate, compute hashes, map to domain models.
 */

import type { VendorInventoryClient, UnknownRawVendorRecord, VendorClientError } from '../../inventoryClient';
import type { HttpTransport } from '../shared/httpTransport';
import type { VendorClientConfig } from '../shared/vendorClientConfig';
import type { CccOneAuthProvider } from './cccOneAuthProvider';
import { cccPartsLookupResponseSchema } from './cccOneResponseSchema';

/**
 * CCC One inventory client.
 *
 * Fetches part alternatives from CCC One's estimating platform.
 * Designed to work with or without the retry decorator.
 */
export class CccOneInventoryClient implements VendorInventoryClient {
  constructor(
    private readonly config: VendorClientConfig,
    private readonly transport: HttpTransport,
    private readonly authProvider: CccOneAuthProvider
  ) {}

  /**
   * Stream part alternatives from CCC One.
   *
   * CCC One does not support bulk pagination. This stream implementation
   * fetches part alternatives for a batch of OEM part numbers passed
   * via the cursor parameter (JSON-encoded array of part numbers).
   *
   * Cursor format: JSON-encoded { partNumbers: string[], index: number }
   */
  async *fetchInventoryStream(params?: {
    cursor?: string;
    batchSize?: number;
  }): AsyncIterable<UnknownRawVendorRecord> {
    const cursorData = this.parseCursor(params?.cursor);
    const partNumbers = cursorData.partNumbers;

    for (let i = cursorData.index; i < partNumbers.length; i++) {
      const page = await this.fetchPartAlternatives(partNumbers[i]);
      for (const record of page.records) {
        yield record;
      }
    }
  }

  /**
   * Fetch alternatives for a single part number.
   *
   * CCC One operates on per-part queries. The cursor parameter
   * is the OEM part number to look up. If no cursor is provided,
   * returns an empty result (CCC does not support browsing).
   *
   * Returns all quality tiers (OEM, aftermarket, recycled, remanufactured)
   * for the queried part number in a single response.
   */
  async fetchInventoryPage(cursor?: string): Promise<{
    records: UnknownRawVendorRecord[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    if (!cursor) {
      return { records: [], hasMore: false };
    }

    // Check if cursor is a structured cursor (batch mode) or plain part number
    const cursorData = this.parseCursor(cursor);
    if (cursorData.partNumbers.length > 0) {
      return this.fetchBatchPage(cursorData);
    }

    // Single part number lookup
    return this.fetchPartAlternatives(cursor);
  }

  /**
   * Health check for CCC One API.
   *
   * Verifies OAuth token acquisition and API availability.
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    latencyMs: number;
    lastSuccessAt?: Date;
    error?: string;
  }> {
    const start = Date.now();
    try {
      // Verify token acquisition works
      const token = await this.authProvider.getAccessToken();
      if (!token) {
        return { status: 'down', latencyMs: Date.now() - start, error: 'Failed to acquire auth token' };
      }

      // Lightweight API probe -- fetch a known common part
      const response = await this.transport.get(
        `${this.config.baseUrl}/parts/lookup?partNumber=HEALTH_CHECK`,
        {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        }
      );

      const latencyMs = Date.now() - start;

      if (response.status === 200 || response.status === 404) {
        // 404 is acceptable for health check -- API is up
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
   * CCC One vendor capability metadata.
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
      supportsStreaming: false,
      supportsRealtimeLookup: true,    // Per-part lookups
      supportsImages: false,            // Estimating platform, not visual
      supportsFitment: true,
      supportsBulkPagination: false,    // No bulk endpoint
      expectedUpdateFrequencyMinutes: 10080, // Weekly updates
      maxRecordsPerRequest: 10,         // Alternatives per lookup
      rateLimitRequestsPerMinute: Math.floor(this.config.rateLimitPerMinute),
    };
  }

  /**
   * Fetch alternatives for a single OEM part number.
   */
  private async fetchPartAlternatives(partNumber: string): Promise<{
    records: UnknownRawVendorRecord[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const token = await this.authProvider.getAccessToken();

    const url = `${this.config.baseUrl}/parts/lookup?partNumber=${encodeURIComponent(partNumber)}`;
    const response = await this.transport.get(url, {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    });

    if (response.status !== 200) {
      this.throwVendorError(response.status, response.headers, response.rawBody);
    }

    const parsed = cccPartsLookupResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      const error: VendorClientError = {
        type: 'VALIDATION_ERROR',
        message: `CCC One response validation failed: ${parsed.error.message}`,
        vendorId: this.config.vendorId,
        correlationId: this.extractRequestId(response.body) ?? 'unknown',
      };
      throw error;
    }

    // Inject cacheAge from response header into each record
    const cacheAge = response.headers['x-cache-age'];
    const records = parsed.data.alternatives.map((alt) => ({
      ...alt,
      cacheAge: cacheAge ?? alt.cacheAge,
      alternativeFor: parsed.data.requestedPartNumber,
    })) as UnknownRawVendorRecord[];

    return { records, hasMore: false };
  }

  /**
   * Process a batch of part numbers using a structured cursor.
   */
  private async fetchBatchPage(cursorData: { partNumbers: string[]; index: number }): Promise<{
    records: UnknownRawVendorRecord[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    if (cursorData.index >= cursorData.partNumbers.length) {
      return { records: [], hasMore: false };
    }

    const currentPartNumber = cursorData.partNumbers[cursorData.index];
    const result = await this.fetchPartAlternatives(currentPartNumber);

    const nextIndex = cursorData.index + 1;
    const hasMore = nextIndex < cursorData.partNumbers.length;

    return {
      records: result.records,
      nextCursor: hasMore
        ? JSON.stringify({ partNumbers: cursorData.partNumbers, index: nextIndex })
        : undefined,
      hasMore,
    };
  }

  /**
   * Parse cursor parameter.
   *
   * Supports two formats:
   * 1. Structured: JSON { partNumbers: string[], index: number }
   * 2. Plain: single part number string
   */
  private parseCursor(cursor?: string): { partNumbers: string[]; index: number } {
    if (!cursor) {
      return { partNumbers: [], index: 0 };
    }

    try {
      const parsed = JSON.parse(cursor) as { partNumbers?: string[]; index?: number };
      if (Array.isArray(parsed.partNumbers)) {
        return { partNumbers: parsed.partNumbers, index: parsed.index ?? 0 };
      }
    } catch {
      // Not JSON -- treat as single part number
    }

    return { partNumbers: [cursor], index: 0 };
  }

  /**
   * Extract CCC request ID from response body.
   */
  private extractRequestId(body: unknown): string | undefined {
    if (body && typeof body === 'object' && 'requestId' in body) {
      const val = (body as Record<string, unknown>).requestId;
      return typeof val === 'string' ? val : undefined;
    }
    return undefined;
  }

  /**
   * Throw structured vendor error for non-200 responses.
   */
  private throwVendorError(status: number, headers: Record<string, string>, rawBody: string): never {
    let errorType: VendorClientError['type'];
    if (status === 429) {
      errorType = 'RATE_LIMIT';
    } else if (status === 401 || status === 403) {
      // Invalidate token on auth errors -- likely expired
      this.authProvider.invalidateToken();
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
      message: `CCC One API returned HTTP ${status}: ${rawBody.substring(0, 200)}`,
      vendorId: this.config.vendorId,
      correlationId: headers['x-request-id'] ?? 'unknown',
    };

    const throwable = new Error(error.message);
    Object.assign(throwable, { status, ...error });
    throw throwable;
  }
}
