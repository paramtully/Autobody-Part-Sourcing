/**
 * Request deduplication interface for preventing duplicate concurrent requests.
 * 
 * When multiple workers or processes attempt the same operation simultaneously,
 * request deduplication ensures only one request is executed and all callers
 * receive the same result.
 */

/**
 * Request deduplication interface for integration with retry utility.
 * 
 * Implementations should use distributed caching (e.g., Redis) or in-memory
 * storage to track in-progress requests and share results.
 */
export interface RequestDeduplicator {
  /**
   * Execute operation with deduplication.
   * 
   * If a request with the same key is already in progress, returns the existing
   * promise. Otherwise, executes the operation and caches the result.
   * 
   * @template T - Return type of the operation
   * @param key - Unique key identifying this request (e.g., requestId, operation hash)
   * @param operation - The operation to execute (only called if not already in progress)
   * @param ttlMs - Optional time-to-live in milliseconds for cached result
   * @returns Promise that resolves with the operation result
   */
  execute<T>(
    key: string,
    operation: () => Promise<T>,
    ttlMs?: number
  ): Promise<T>;

  /**
   * Check if a request with the given key is currently in progress.
   * 
   * @param key - Unique key identifying the request
   * @returns true if request is in progress
   */
  isInProgress(key: string): boolean;
}
