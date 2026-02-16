/**
 * Car-Part.com / Hollander inventory client.
 *
 * Implements VendorInventoryClient for Car-Part.com's REST API
 * with HTML scraping as a fallback enrichment path.
 *
 * Integration profile:
 * - Auth: API key
 * - Pagination: Cursor-based (REST API), offset-based (scraping)
 * - Rate limit: ~100 req/min, X-RateLimit-Remaining header
 * - Key behavior: Explicit partStatus enum ('available', 'limited', 'out_of_stock')
 * - Hollander interchange database is the primary value
 * - Listings disappear after sale (no explicit deactivation)
 *
 * Primary use: Hollander interchange resolution + recycled part inventory.
 *
 * Does NOT: write to DB, deduplicate, compute hashes, map to domain models.
 */

import type { VendorInventoryClient, UnknownRawVendorRecord, VendorClientError } from '../../inventoryClient';
import type { HttpTransport } from '../shared/httpTransport';
import type { VendorClientConfig } from '../shared/vendorClientConfig';
import { carPartSearchResponseSchema } from './carPartComResponseSchema';
import { parseCarPartSearchResults, parsedListingsToRecords } from './carPartComParser';

/** Default page size for Car-Part.com inventory requests. */
const DEFAULT_PAGE_SIZE = 100;

/**
 * Car-Part.com inventory client.
 *
 * Fetches recycled parts inventory and Hollander interchange data.
 * Supports both REST API (preferred) and HTML scraping (fallback).
 */
export class CarPartComInventoryClient implements VendorInventoryClient {
  constructor(
    private readonly config: VendorClientConfig,
    private readonly transport: HttpTransport,
    private readonly preferApi: boolean = true
  ) {}

  /**
   * Stream inventory records from Car-Part.com.
   *
   * Iterates through all pages, yielding individual records.
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
   * Fetch a single page of inventory from Car-Part.com.
   *
   * Tries REST API first, falls back to HTML scraping if API is unavailable.
   *
   * Handles Car-Part.com-specific behavior:
   * - Explicit partStatus field ('available', 'limited', 'out_of_stock')
   * - Hollander interchange codes in responses
   * - Rate limit tracking via X-RateLimit-Remaining header
   */
  async fetchInventoryPage(cursor?: string): Promise<{
    records: UnknownRawVendorRecord[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    if (this.preferApi) {
      return this.fetchViaApi(cursor);
    }
    return this.fetchViaScraping(cursor);
  }

  /**
   * Health check for Car-Part.com.
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    latencyMs: number;
    lastSuccessAt?: Date;
    error?: string;
  }> {
    const start = Date.now();
    try {
      const apiKeyParam = this.getApiKeyParam();
      const response = await this.transport.get(
        `${this.config.baseUrl}/api/v1/search?limit=1${apiKeyParam}`,
        { 'Accept': 'application/json' }
      );

      const latencyMs = Date.now() - start;

      // Check rate limit headroom
      const remaining = response.headers['x-ratelimit-remaining'];
      const isLowOnRateLimit = remaining !== undefined && parseInt(remaining, 10) < 10;

      if (response.status === 200) {
        return {
          status: isLowOnRateLimit || latencyMs > 5000 ? 'degraded' : 'healthy',
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
   * Car-Part.com vendor capability metadata.
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
      supportsRealtimeLookup: true,     // Per-part search supported
      supportsImages: true,              // Some listings have images
      supportsFitment: true,             // Hollander interchange data
      supportsBulkPagination: true,
      expectedUpdateFrequencyMinutes: 360,  // Every 4-6 hours
      maxRecordsPerRequest: DEFAULT_PAGE_SIZE,
      rateLimitRequestsPerMinute: this.config.rateLimitPerMinute,
    };
  }

  /**
   * Fetch inventory via REST API.
   */
  private async fetchViaApi(cursor?: string): Promise<{
    records: UnknownRawVendorRecord[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const apiKeyParam = this.getApiKeyParam();
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const url = `${this.config.baseUrl}/api/v1/search?limit=${DEFAULT_PAGE_SIZE}${cursorParam}${apiKeyParam}`;

    const response = await this.transport.get(url, {
      'Accept': 'application/json',
    });

    if (response.status !== 200) {
      // If API returns error, try scraping fallback
      if (response.status === 404 || response.status === 503) {
        return this.fetchViaScraping(cursor);
      }
      this.throwVendorError(response.status, response.headers, response.rawBody);
    }

    const parsed = carPartSearchResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      // If JSON response doesn't parse, try HTML scraping fallback
      if (response.headers['content-type']?.includes('text/html')) {
        return this.parseHtmlResponse(response.rawBody);
      }

      const error: VendorClientError = {
        type: 'VALIDATION_ERROR',
        message: `Car-Part.com response validation failed: ${parsed.error.message}`,
        vendorId: this.config.vendorId,
        correlationId: 'unknown',
      };
      throw error;
    }

    return {
      records: parsed.data.listings as UnknownRawVendorRecord[],
      nextCursor: parsed.data.nextCursor,
      hasMore: parsed.data.hasMore,
    };
  }

  /**
   * Fetch inventory via HTML scraping (fallback path).
   */
  private async fetchViaScraping(cursor?: string): Promise<{
    records: UnknownRawVendorRecord[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const page = cursor ? parseInt(cursor, 10) : 1;
    const url = `${this.config.baseUrl}/cgi-bin/search.cgi?page=${page}`;

    const response = await this.transport.get(url, {
      'Accept': 'text/html',
    });

    if (response.status !== 200) {
      this.throwVendorError(response.status, response.headers, response.rawBody);
    }

    return this.parseHtmlResponse(response.rawBody, page);
  }

  /**
   * Parse HTML response into structured records.
   */
  private parseHtmlResponse(html: string, currentPage: number = 1): {
    records: UnknownRawVendorRecord[];
    nextCursor?: string;
    hasMore: boolean;
  } {
    const parsed = parseCarPartSearchResults(html, this.config.baseUrl);
    const records = parsedListingsToRecords(parsed, this.config.vendorId);

    // Detect if there's a next page by checking for pagination indicators
    const hasNextPage = html.includes('Next') || html.includes('next_page');

    return {
      records,
      nextCursor: hasNextPage ? String(currentPage + 1) : undefined,
      hasMore: hasNextPage,
    };
  }

  /**
   * Get API key query parameter.
   */
  private getApiKeyParam(): string {
    if (this.config.credentials.type === 'API_KEY_HMAC') {
      return `&api_key=${encodeURIComponent(this.config.credentials.apiKey)}`;
    }
    return '';
  }

  /**
   * Throw structured vendor error.
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
      message: `Car-Part.com returned HTTP ${status}: ${rawBody.substring(0, 200)}`,
      vendorId: this.config.vendorId,
      correlationId: headers['x-request-id'] ?? 'unknown',
    };

    const throwable = new Error(error.message);
    Object.assign(throwable, { status, ...error });
    throw throwable;
  }
}
