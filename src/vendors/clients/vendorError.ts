
/**
 * Error classification for retry logic.
 */
export type VendorErrorType =
  | 'NETWORK_ERROR'   // fetch() threw — retryable
  | 'TIMEOUT'         // retryable
  | 'RATE_LIMIT'      // retryable, honour retryAfterMs
  | 'SERVER_ERROR'    // 5xx — retryable
  | 'AUTH_ERROR'      // 401/403 — non-retryable
  | 'INVALID_REQUEST' // 400 — non-retryable
  | 'VALIDATION_ERROR'; // bad response shape — non-retryable

export const RETRYABLE: Set<VendorErrorType> = new Set([
  'NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'SERVER_ERROR',
]);


/**
 * Structured error information for logging.
 */
export class VendorError extends Error {
  constructor(
    public readonly type: VendorErrorType,
    message: string,
    public readonly retryAfterMs?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VendorError';
  }

  get isRetryable(): boolean {
    return RETRYABLE.has(this.type);
  }
}