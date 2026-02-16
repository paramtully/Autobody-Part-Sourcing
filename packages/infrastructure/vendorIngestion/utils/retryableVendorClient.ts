/**
 * RetryableVendorClient: Decorator that wraps any VendorInventoryClient
 * with retry logic (exponential backoff, jitter, circuit breaker, rate limiting).
 *
 * Key design principle: The underlying client has ZERO knowledge of retry.
 * The orchestrator wraps the client with this decorator at composition time.
 * If retry is not needed, the orchestrator uses the client directly.
 *
 * This is the "decoupling seam" between System 1 (client) and System 2 (retry):
 * - Client never imports retry.ts
 * - Retry never imports any specific client
 * - Both implement the same VendorInventoryClient interface
 *
 * Usage:
 *   const rawClient = new LKQInventoryClient(config, transport);
 *   const client = new RetryableVendorClient(rawClient, retryOptions);
 *   // 'client' is a VendorInventoryClient -- orchestrator doesn't know it retries
 */

import type { VendorInventoryClient, UnknownRawVendorRecord } from '../inventoryClient';
import { retryAsync } from './retry';
import type { RetryOptions } from './retry';

/**
 * Configuration for the RetryableVendorClient decorator.
 *
 * This is a subset of RetryOptions focused on what makes sense
 * for vendor inventory fetching. The full RetryOptions are available
 * for advanced use cases.
 */
export interface RetryableVendorClientOptions<C = unknown> {
  /** Full retry options passed directly to retryAsync. */
  retryOptions: RetryOptions<C>;
}

/**
 * Decorator that wraps a VendorInventoryClient with retry logic.
 *
 * Implements the same VendorInventoryClient interface, so the
 * orchestrator can't tell the difference between a raw client
 * and a retryable one. This is the "transparent proxy" pattern.
 *
 * Retry is applied to:
 * - fetchInventoryPage (each page fetch is retried independently)
 * - healthCheck (for reliability monitoring)
 * - getAuthStatus (if the inner client supports it)
 * - fetchByPartNumbers (if the inner client supports it)
 *
 * NOT retried:
 * - fetchInventoryStream (yields individual records; retry at page level)
 * - getVendorCapabilities (returns static metadata)
 */
export class RetryableVendorClient implements VendorInventoryClient {
  readonly vendorId?: string;

  constructor(
    private readonly inner: VendorInventoryClient,
    private readonly options: RetryableVendorClientOptions
  ) {
    this.vendorId = inner.vendorId;
  }

  /**
   * Stream with retry at the page level.
   *
   * Each page fetch is independently retried. If a page fails
   * after all retries, the stream throws and the orchestrator
   * can checkpoint and resume from the last successful cursor.
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
   * Fetch a single page with retry.
   */
  async fetchInventoryPage(cursor?: string): Promise<{
    records: UnknownRawVendorRecord[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return retryAsync(
      () => this.inner.fetchInventoryPage(cursor),
      this.options.retryOptions
    );
  }

  /**
   * Fetch by part numbers with retry (if inner client supports it).
   */
  async fetchByPartNumbers?(partNumbers: string[]): Promise<UnknownRawVendorRecord[]> {
    if (!this.inner.fetchByPartNumbers) {
      throw new Error('Inner client does not support fetchByPartNumbers');
    }
    return retryAsync(
      () => this.inner.fetchByPartNumbers!(partNumbers),
      this.options.retryOptions
    );
  }

  /**
   * Health check with retry.
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    latencyMs: number;
    lastSuccessAt?: Date;
    error?: string;
  }> {
    return retryAsync(
      () => this.inner.healthCheck(),
      this.options.retryOptions
    );
  }

  /**
   * Auth status with retry (if inner client supports it).
   */
  async getAuthStatus?(): Promise<{ valid: boolean; expiresAt?: Date }> {
    if (!this.inner.getAuthStatus) {
      return { valid: true };
    }
    return retryAsync(
      () => this.inner.getAuthStatus!(),
      this.options.retryOptions
    );
  }

  /**
   * Vendor capabilities are static metadata -- no retry needed.
   */
  getVendorCapabilities(): {
    supportsStreaming: boolean;
    supportsRealtimeLookup: boolean;
    supportsImages: boolean;
    supportsFitment: boolean;
    supportsBulkPagination: boolean;
    expectedUpdateFrequencyMinutes: number;
    maxRecordsPerRequest?: number;
    rateLimitRequestsPerMinute?: number;
  } {
    return this.inner.getVendorCapabilities();
  }
}
