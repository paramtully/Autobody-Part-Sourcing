/**
 * Rate limiter interface for coordinating requests across multiple workers.
 * 
 * Prevents exceeding vendor rate limits by tracking request counts and
 * enforcing delays when limits are approached.
 */

/**
 * Rate limiter interface for integration with retry utility.
 * 
 * Implementations should use distributed storage (e.g., Redis) to coordinate
 * rate limiting across multiple workers/processes.
 */
export interface RateLimiter {
  /**
   * Wait until rate limit allows operation, then return.
   * 
   * If rate limit is not exceeded, returns immediately with 0 delay.
   * If rate limit is exceeded, waits until next window and returns the
   * delay in milliseconds that was waited.
   * 
   * @param key - Unique key identifying the rate limit scope (e.g., vendorId)
   * @returns Promise that resolves with delay in milliseconds (0 if no wait needed)
   */
  waitIfNeeded(key: string): Promise<number>;

  /**
   * Record that an operation was performed.
   * 
   * Should increment the request count for the given key.
   * 
   * @param key - Unique key identifying the rate limit scope (e.g., vendorId)
   */
  recordOperation(key: string): void;
}
