/**
 * Raw vendor record type - shape unknown until validated by Zod schema.
 * This type represents a single inventory record from a vendor API before validation.
 */
export type UnknownRawVendorRecord = unknown;

/**
 * Vendor inventory client interface.
 * 
 * Responsibilities (FETCH/NORMALIZE ONLY):
 * - Fetch inventory pages OR stream inventory records
 * - Handle retries with exponential backoff + jitter
 * - Classify retryable vs terminal errors
 * - Normalize transport-level data only (HTTP → JSON)
 * - Return data compatible with Zod schema
 * - Expose vendor capability metadata
 * - Handle authentication and rate limiting
 * 
 * DO NOT:
 * - Write to DB
 * - Deduplicate listings
 * - Compute hashes
 * - Map to domain models
 * - Emit events
 * - Store raw payloads
 */
export interface VendorInventoryClient {
  /**
   * Stream inventory records from vendor API.
   * Returns async iterable for memory-efficient processing of large catalogs.
   * Each yielded item is a raw vendor record (unknown shape, validated by Zod).
   * 
   * @param params - Optional parameters for streaming
   * @param params.cursor - Optional cursor/offset for resuming from a specific point
   * @param params.batchSize - Optional batch size for internal batching (defaults to vendor-specific)
   * @returns Async iterable of raw vendor records
   */
  fetchInventoryStream(params?: {
    cursor?: string;
    batchSize?: number;
  }): AsyncIterable<UnknownRawVendorRecord>;

  /**
   * Fetch a single page of inventory (for vendors that don't support streaming).
   * Returns paginated response with cursor for next page.
   * 
   * @param cursor - Optional cursor/offset for pagination
   * @returns Paginated response with records and pagination metadata
   */
  fetchInventoryPage(cursor?: string): Promise<{
    records: UnknownRawVendorRecord[];
    nextCursor?: string;
    hasMore: boolean;
  }>;

  /**
   * Optional: Fetch inventory for specific part numbers (if vendor supports lookup).
   * Not all vendors support this - capability metadata indicates availability.
   * 
   * @param partNumbers - Array of part numbers to lookup
   * @returns Array of raw vendor records matching the part numbers
   */
  fetchByPartNumbers?(partNumbers: string[]): Promise<UnknownRawVendorRecord[]>;

  /**
   * Health check for vendor API.
   * Used by scheduler to determine if vendor is available.
   * 
   * @returns Health status with latency and error information
   */
  healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    latencyMs: number;
    lastSuccessAt?: Date;
    error?: string;
  }>;

  /**
   * Get vendor capability metadata.
   * Used by scheduler to optimize polling frequency and ingestion strategy.
   * 
   * @returns Vendor capability information
   */
  getVendorCapabilities(): {
    supportsStreaming: boolean;
    supportsRealtimeLookup: boolean;
    supportsImages: boolean;
    supportsFitment: boolean;
    supportsBulkPagination: boolean;
    expectedUpdateFrequencyMinutes: number; // How often vendor typically updates
    maxRecordsPerRequest?: number;
    rateLimitRequestsPerMinute?: number;
  };
}

/**
 * Error classification for retry logic.
 */
export type RetryableError = 
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR';

export type NonRetryableError =
  | 'AUTH_ERROR'
  | 'INVALID_REQUEST'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND';

/**
 * Structured error information for logging.
 */
export interface VendorClientError {
  type: RetryableError | NonRetryableError;
  message: string;
  vendorId: string;
  correlationId: string;
  retryAttempt?: number;
  maxRetries?: number;
  retryAfterMs?: number;
  originalError?: unknown;
}
