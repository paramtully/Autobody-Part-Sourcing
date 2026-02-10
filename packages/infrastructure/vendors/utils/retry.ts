/**
 * Network retry utility for vendor API clients.
 * 
 * Provides robust retry logic with exponential backoff, full jitter,
 * Retry-After header support, timeout handling, and cancellation support.
 * 
 * This utility is designed for network reliability only and does not
 * contain business logic, DB writes, or ingestion state tracking.
 */

import type { RetryableError, NonRetryableError } from '../inventoryClient';
import type { CircuitBreaker } from './circuitBreaker';
import type { RequestDeduplicator } from './requestDeduplicator';
import type { RateLimiter } from './rateLimiter';

/**
 * Configuration options for retry behavior.
 * 
 * @template C - Context type for structured logging and error classification
 */
export interface RetryOptions<C = unknown> {
  /**
   * Base delay in milliseconds for exponential backoff.
   * Default: 1000ms
   */
  baseDelay?: number;

  /**
   * Maximum delay in milliseconds (caps exponential backoff).
   * Default: 30000ms
   * Must be >= baseDelay
   */
  maxDelay?: number;

  /**
   * Exponential multiplier for backoff calculation.
   * Default: 2
   */
  exponentialMultiplier?: number;

  /**
   * Maximum number of retry attempts (including initial attempt).
   * Default: 3
   * Must be >= 1
   */
  maxAttempts?: number;

  /**
   * Function to determine if an error should trigger a retry.
   * Receives the error, attempt number, and optional context.
   * 
   * @param error - The error that occurred
   * @param attemptNumber - Current attempt number (1-indexed)
   * @param context - Optional context object
   * @returns true if the error should be retried
   */
  shouldRetry: (error: unknown, attemptNumber: number, context?: C) => boolean;

  /**
   * Timeout per attempt in milliseconds.
   * If undefined, no per-attempt timeout is applied.
   * Default: undefined
   */
  timeoutPerAttempt?: number;

  /**
   * Maximum total duration across all retries in milliseconds.
   * If undefined, no total duration limit is enforced.
   * Default: undefined
   */
  maxTotalDuration?: number;

  /**
   * AbortSignal for cancellation support.
   * If provided, the operation can be cancelled.
   */
  signal?: AbortSignal;

  /**
   * Whether the operation accepts AbortSignal for cancellation.
   * If true, operation signature is (signal?: AbortSignal) => Promise<T>
   * If false or undefined, operation signature is () => Promise<T>
   * Default: false (backward compatible)
   * 
   * When enabled, the retry utility will pass an AbortSignal to the operation
   * that can be used to cancel in-flight requests when timeouts occur.
   */
  operationAcceptsSignal?: boolean;

  /**
   * Circuit breaker for preventing retry storms when vendor is down.
   * If provided, circuit breaker state is checked before each attempt.
   * If circuit is open, operation fails immediately (non-retryable).
   */
  circuitBreaker?: CircuitBreaker;

  /**
   * Request deduplicator for preventing duplicate concurrent requests.
   * If provided, duplicate requests (same requestId) will share the same result.
   */
  requestDeduplicator?: RequestDeduplicator;

  /**
   * Unique identifier for this request (used with requestDeduplicator).
   * If not provided and requestDeduplicator is set, a hash of the operation
   * may be used (implementation dependent).
   */
  requestId?: string;

  /**
   * Rate limiter for coordinating requests across multiple workers.
   * If provided, rate limiter is checked before each attempt.
   * If rate limit exceeded, operation waits until allowed.
   */
  rateLimiter?: RateLimiter;

  /**
   * Key for rate limiting (e.g., vendorId).
   * Required if rateLimiter is provided.
   */
  rateLimitKey?: string;

  /**
   * Result validator function.
   * If provided, result is validated after operation succeeds.
   * If validation fails, result is treated as an error and retried (if retryable).
   * 
   * @param result - The operation result to validate
   * @param attemptNumber - Current attempt number (1-indexed)
   * @param context - Optional context object
   * @returns Validation result: { valid: true } or { valid: false; error: unknown }
   */
  validateResult?: (result: T, attemptNumber: number, context?: C) => 
    | { valid: true }
    | { valid: false; error: unknown };

  /**
   * Callback invoked when a retry is about to occur.
   * 
   * @param attemptNumber - The attempt number that will be retried (1-indexed)
   * @param delayMs - The delay before retry in milliseconds
   * @param error - The error that triggered the retry
   * @param context - Optional context object
   */
  onRetry?: (attemptNumber: number, delayMs: number, error: unknown, context?: C) => void;

  /**
   * Callback invoked when all retries are exhausted.
   * 
   * @param attemptNumber - The final attempt number
   * @param error - The final error that caused failure
   * @param errorHistory - Array of all errors encountered during retry attempts (for debugging)
   * @param context - Optional context object
   */
  onGiveUp?: (attemptNumber: number, error: unknown, errorHistory: unknown[], context?: C) => void;

  /**
   * Callback invoked when the operation succeeds.
   * 
   * @param attemptNumber - The attempt number that succeeded (1-indexed)
   * @param durationMs - Total duration in milliseconds
   * @param context - Optional context object
   */
  onSuccess?: (attemptNumber: number, durationMs: number, context?: C) => void;

  /**
   * Callback invoked when a logging callback (onRetry, onGiveUp, onSuccess) throws an error.
   * This prevents callback errors from masking the original operation error.
   * 
   * @param callbackName - Name of the callback that failed ('onRetry', 'onGiveUp', 'onSuccess')
   * @param error - The error thrown by the callback
   * @param context - Optional context object
   */
  onCallbackError?: (callbackName: string, error: unknown, context?: C) => void;

  /**
   * Optional context object passed to callbacks and shouldRetry function.
   * Not passed to the operation itself.
   */
  context?: C;
}

/**
 * Default retry options.
 */
const DEFAULT_OPTIONS: Required<Pick<RetryOptions, 'baseDelay' | 'maxDelay' | 'exponentialMultiplier' | 'maxAttempts'>> = {
  baseDelay: 1000,
  maxDelay: 30000,
  exponentialMultiplier: 2,
  maxAttempts: 3,
};

/**
 * Network error codes that indicate retryable failures.
 */
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNABORTED',
]);

/**
 * Network error names that indicate retryable failures.
 */
const RETRYABLE_NETWORK_ERROR_NAMES = new Set([
  'TimeoutError',
  'NetworkError',
  'AbortError',
]);

/**
 * Checks if an error is a network-level error.
 * 
 * @param error - The error to check
 * @returns true if the error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    
    // Check error code (Node.js network errors)
    if (typeof err.code === 'string' && RETRYABLE_NETWORK_ERROR_CODES.has(err.code)) {
      return true;
    }
    
    // Check error name
    if (typeof err.name === 'string' && RETRYABLE_NETWORK_ERROR_NAMES.has(err.name)) {
      return true;
    }
    
    // Check error message for common network error patterns
    if (typeof err.message === 'string') {
      const message = err.message.toLowerCase();
      if (
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('connection') ||
        message.includes('econnreset') ||
        message.includes('etimedout') ||
        message.includes('enotfound')
      ) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Safely extracts HTTP status code from various error shapes.
 * Supports axios, fetch, node-fetch, and custom error formats.
 * 
 * @param error - The error to extract status code from
 * @returns The status code if found, null otherwise
 */
export function extractStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  
  const err = error as Record<string, unknown>;
  
  // Check common status code locations
  if (typeof err.status === 'number') {
    return err.status;
  }
  
  if (typeof err.statusCode === 'number') {
    return err.statusCode;
  }
  
  // Check response object (axios, fetch)
  if (err.response && typeof err.response === 'object') {
    const response = err.response as Record<string, unknown>;
    if (typeof response.status === 'number') {
      return response.status;
    }
    if (typeof response.statusCode === 'number') {
      return response.statusCode;
    }
  }
  
  return null;
}

/**
 * Checks if an error is an HTTP error with a status code.
 * 
 * @param error - The error to check
 * @returns true if the error has an HTTP status code
 */
export function isHttpError(error: unknown): boolean {
  return extractStatusCode(error) !== null;
}

/**
 * Extracts Retry-After header value from error objects.
 * Supports various HTTP client error shapes.
 * 
 * @param error - The error to extract Retry-After from
 * @returns The Retry-After header value if found, null otherwise
 */
function extractRetryAfterHeader(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  
  const err = error as Record<string, unknown>;
  
  // Check response.headers (axios, node-fetch)
  if (err.response && typeof err.response === 'object') {
    const response = err.response as Record<string, unknown>;
    if (response.headers && typeof response.headers === 'object') {
      const headers = response.headers as Record<string, unknown>;
      
      // Case-insensitive header lookup
      const retryAfter = 
        headers['retry-after'] ||
        headers['Retry-After'] ||
        headers['RETRY-AFTER'];
      
      if (typeof retryAfter === 'string') {
        return retryAfter;
      }
    }
  }
  
  // Check headers directly (some fetch implementations)
  if (err.headers && typeof err.headers === 'object') {
    const headers = err.headers as Record<string, unknown>;
    const retryAfter = 
      headers['retry-after'] ||
      headers['Retry-After'] ||
      headers['RETRY-AFTER'];
    
    if (typeof retryAfter === 'string') {
      return retryAfter;
    }
  }
  
  return null;
}

/**
 * Parses Retry-After header value into milliseconds.
 * 
 * Supports two formats:
 * - Integer seconds: "120" → 120000ms
 * - HTTP-date: "Wed, 21 Oct 2015 07:28:00 GMT" → milliseconds until that time
 * 
 * @param retryAfter - The Retry-After header value
 * @param maxDelay - Maximum delay to cap the result at
 * @returns Delay in milliseconds, or null if parsing fails
 */
export function parseRetryAfter(
  retryAfter: string | null | undefined,
  maxDelay: number
): number | null {
  if (!retryAfter || typeof retryAfter !== 'string') {
    return null;
  }
  
  const trimmed = retryAfter.trim();
  if (!trimmed) {
    return null;
  }
  
  // Try parsing as integer seconds first
  const seconds = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(seconds) && seconds >= 0 && Number.isFinite(seconds)) {
    const delayMs = seconds * 1000;
    return Math.min(delayMs, maxDelay);
  }
  
  // Try parsing as HTTP-date
  try {
    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) {
      const now = Date.now();
      const delayMs = date.getTime() - now;
      // Explicit check for negative or zero delays
      if (delayMs <= 0) {
        // Date is in the past or same time, return null
        return null;
      }
      return Math.min(delayMs, maxDelay);
    }
  } catch {
    // Date parsing failed, fall through to return null
  }
  
  return null;
}

/**
 * Calculates jittered delay using full jitter algorithm.
 * 
 * Full jitter: random(0, baseDelay * multiplier^(attempt-1))
 * Result is capped at maxDelay.
 * 
 * @param attemptNumber - Current attempt number (1-indexed)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @param exponentialMultiplier - Exponential multiplier
 * @returns Jittered delay in milliseconds
 */
export function calculateJitteredDelay(
  attemptNumber: number,
  baseDelay: number,
  maxDelay: number,
  exponentialMultiplier: number
): number {
  // Calculate exponential delay: baseDelay * multiplier^(attempt-1)
  const exponentialDelay = baseDelay * Math.pow(exponentialMultiplier, attemptNumber - 1);
  
  // Apply full jitter: random(0, exponentialDelay)
  const jitteredDelay = Math.random() * exponentialDelay;
  
  // Cap at maxDelay
  return Math.min(jitteredDelay, maxDelay);
}

/**
 * Default retry classification function.
 * 
 * Returns true for:
 * - Network errors (ECONNRESET, ETIMEDOUT, ENOTFOUND, etc.)
 * - Timeout errors
 * - 429 (rate limit) responses
 * - 5xx (server error) responses
 * 
 * Returns false for:
 * - 400 (bad request)
 * - 401 (unauthorized)
 * - 403 (forbidden)
 * - 404 (not found) - unless context indicates scraper integration
 * 
 * @param error - The error to classify
 * @param attemptNumber - Current attempt number (1-indexed)
 * @param context - Optional context with integrationType
 * @returns true if the error should be retried
 */
export function defaultShouldRetry(
  error: unknown,
  attemptNumber: number,
  context?: { integrationType?: string }
): boolean {
  // Network errors are always retryable
  if (isNetworkError(error)) {
    return true;
  }
  
  // Check HTTP status code
  const statusCode = extractStatusCode(error);
  if (statusCode !== null) {
    // 429 (rate limit) is retryable
    if (statusCode === 429) {
      return true;
    }
    
    // 5xx (server errors) are retryable
    if (statusCode >= 500 && statusCode < 600) {
      return true;
    }
    
    // 400, 401, 403 are non-retryable
    if (statusCode === 400 || statusCode === 401 || statusCode === 403) {
      return false;
    }
    
    // 404 is non-retryable for APIs, but may be retryable for scrapers
    if (statusCode === 404) {
      // Scrapers may have transient 404s due to page structure changes
      return context?.integrationType === 'SCRAPER';
    }
  }
  
  // Check for timeout errors by name
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if (typeof err.name === 'string' && err.name === 'TimeoutError') {
      return true;
    }
  }
  
  // Default to non-retryable for unknown errors
  return false;
}

/**
 * Classifies an error into RetryableError or NonRetryableError types.
 * 
 * @param error - The error to classify
 * @returns The error type, or null if classification is not possible
 */
export function classifyErrorType(error: unknown): RetryableError | NonRetryableError | null {
  // Network errors
  if (isNetworkError(error)) {
    return 'NETWORK_ERROR';
  }
  
  // Check HTTP status code
  const statusCode = extractStatusCode(error);
  if (statusCode !== null) {
    if (statusCode === 429) {
      return 'RATE_LIMIT';
    }
    if (statusCode >= 500 && statusCode < 600) {
      return 'SERVER_ERROR';
    }
    if (statusCode === 401 || statusCode === 403) {
      return 'AUTH_ERROR';
    }
    if (statusCode === 400) {
      return 'INVALID_REQUEST';
    }
    if (statusCode === 404) {
      return 'NOT_FOUND';
    }
  }
  
  // Check for timeout errors
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if (typeof err.name === 'string' && err.name === 'TimeoutError') {
      return 'TIMEOUT';
    }
  }
  
  return null;
}

/**
 * Maps an error to a RetryableError type.
 * 
 * @param error - The error to map
 * @returns The RetryableError type, or null if not retryable
 */
export function mapToRetryableError(error: unknown): RetryableError | null {
  const type = classifyErrorType(error);
  if (type === 'TIMEOUT' || type === 'RATE_LIMIT' || type === 'SERVER_ERROR' || type === 'NETWORK_ERROR') {
    return type;
  }
  return null;
}

/**
 * Maps an error to a NonRetryableError type.
 * 
 * @param error - The error to map
 * @returns The NonRetryableError type, or null if not non-retryable
 */
export function mapToNonRetryableError(error: unknown): NonRetryableError | null {
  const type = classifyErrorType(error);
  if (type === 'AUTH_ERROR' || type === 'INVALID_REQUEST' || type === 'VALIDATION_ERROR' || type === 'NOT_FOUND') {
    return type;
  }
  return null;
}

/**
 * Creates a timeout promise that rejects after the specified delay.
 * 
 * @param timeoutMs - Timeout in milliseconds
 * @param signal - Optional AbortSignal for cancellation
 * @returns Promise that rejects with a timeout error
 */
function createTimeoutPromise(timeoutMs: number, signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(new Error('Operation cancelled'));
      return;
    }
    
    let timeoutId: NodeJS.Timeout | undefined = setTimeout(() => {
      timeoutId = undefined;
      const error = new Error(`Operation timed out after ${timeoutMs}ms`);
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
    
    // Clean up timeout if signal is aborted
    if (signal) {
      const abortHandler = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        signal.removeEventListener('abort', abortHandler);
        reject(new Error('Operation cancelled'));
      };
      signal.addEventListener('abort', abortHandler);
    }
  });
}

/**
 * Delays execution for the specified number of milliseconds.
 * 
 * @param delayMs - Delay in milliseconds
 * @param signal - Optional AbortSignal for cancellation
 * @returns Promise that resolves after the delay, or rejects if cancelled
 */
function delay(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Operation cancelled'));
      return;
    }
    
    let timeoutId: NodeJS.Timeout | undefined = setTimeout(() => {
      timeoutId = undefined;
      resolve();
    }, delayMs);
    
    // Clean up timeout if signal is aborted
    if (signal) {
      const abortHandler = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        signal.removeEventListener('abort', abortHandler);
        reject(new Error('Operation cancelled'));
      };
      signal.addEventListener('abort', abortHandler);
    }
  });
}

/**
 * Retries an async operation with exponential backoff and full jitter.
 * 
 * **IMPORTANT: Idempotency Requirement**
 * 
 * The operation being retried MUST be idempotent. This means:
 * - Executing the operation multiple times produces the same result
 * - No side effects occur on repeated execution
 * - Safe to retry after network failures, timeouts, or errors
 * 
 * Examples of idempotent operations:
 * - GET requests (read-only)
 * - Idempotent POST/PUT with idempotency keys
 * - Database upserts with conflict resolution
 * 
 * Examples of NON-idempotent operations (DO NOT retry):
 * - POST requests that create new resources without idempotency keys
 * - Operations that increment counters
 * - Operations that send emails/notifications
 * 
 * Features:
 * - Exponential backoff with full jitter
 * - Retry-After header support (429 responses)
 * - Per-attempt timeout support with proper cancellation
 * - Max total duration support
 * - AbortSignal cancellation
 * - Structured logging hooks
 * - Context-aware error classification
 * - Circuit breaker integration (optional)
 * - Request deduplication (optional)
 * - Rate limiting coordination (optional)
 * - Result validation (optional)
 * 
 * @template T - Return type of the operation
 * @template C - Context type for logging and classification
 * @param operation - The async operation to retry. Signature depends on `operationAcceptsSignal`:
 *   - If `operationAcceptsSignal: false` (default): `() => Promise<T>`
 *   - If `operationAcceptsSignal: true`: `(signal?: AbortSignal) => Promise<T>`
 * @param options - Retry configuration options
 * @returns Promise that resolves with the operation result
 * @throws The last error if all retries are exhausted
 */
export async function retryAsync<T, C = unknown>(
  operation: ((signal?: AbortSignal) => Promise<T>) | (() => Promise<T>),
  options: RetryOptions<C>
): Promise<T> {
  const {
    baseDelay = DEFAULT_OPTIONS.baseDelay,
    maxDelay = DEFAULT_OPTIONS.maxDelay,
    exponentialMultiplier = DEFAULT_OPTIONS.exponentialMultiplier,
    maxAttempts = DEFAULT_OPTIONS.maxAttempts,
    shouldRetry,
    timeoutPerAttempt,
    maxTotalDuration,
    signal,
    operationAcceptsSignal = false,
    circuitBreaker,
    requestDeduplicator,
    requestId,
    rateLimiter,
    rateLimitKey,
    validateResult,
    onRetry,
    onGiveUp,
    onSuccess,
    context,
  } = options;
  
  // Validate options
  if (maxDelay < baseDelay) {
    throw new Error(`maxDelay (${maxDelay}) must be >= baseDelay (${baseDelay})`);
  }
  
  if (maxAttempts < 1) {
    throw new Error(`maxAttempts (${maxAttempts}) must be >= 1`);
  }
  
  const startTime = performance.now();
  let lastError: unknown;
  const errorHistory: unknown[] = [];
  
  // Helper function to safely invoke callbacks
  const safeInvokeCallback = (
    callbackName: 'onRetry' | 'onGiveUp' | 'onSuccess',
    callback: ((...args: unknown[]) => void) | undefined,
    args: unknown[]
  ): void => {
    if (!callback) return;
    try {
      callback(...args);
    } catch (callbackError) {
      if (options.onCallbackError) {
        options.onCallbackError(callbackName, callbackError, context);
      }
      // Continue execution - don't let callback errors mask original errors
    }
  };
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check if cancelled before starting attempt
    if (signal?.aborted) {
      const error = new Error('Operation cancelled');
      error.name = 'AbortError';
      throw error;
    }
    
    // Check circuit breaker before starting attempt
    if (circuitBreaker?.isOpen()) {
      const error = new Error(`Circuit breaker is open (state: ${circuitBreaker.getState()})`);
      error.name = 'CircuitBreakerOpenError';
      // Circuit breaker errors are non-retryable
      errorHistory.push(error);
      safeInvokeCallback('onGiveUp', onGiveUp, [attempt, error, errorHistory, context]);
      throw error;
    }
    
    // Check rate limiter before starting attempt
    let rateLimitDelay = 0;
    if (rateLimiter && rateLimitKey) {
      try {
        rateLimitDelay = await rateLimiter.waitIfNeeded(rateLimitKey);
      } catch (rateLimitError) {
        // Rate limiter error - treat as non-retryable
        const error = new Error(`Rate limiter error: ${rateLimitError}`);
        error.name = 'RateLimiterError';
        errorHistory.push(error);
        safeInvokeCallback('onGiveUp', onGiveUp, [attempt, error, errorHistory, context]);
        throw error;
      }
    }
    
    // Check max total duration before starting attempt
    if (maxTotalDuration !== undefined) {
      const elapsed = performance.now() - startTime;
      if (elapsed >= maxTotalDuration) {
        const error = new Error(`Operation exceeded max total duration of ${maxTotalDuration}ms`);
        error.name = 'TimeoutError';
        safeInvokeCallback('onGiveUp', onGiveUp, [attempt, error, errorHistory, context]);
        throw error;
      }
    }
    
    try {
      // Wrap operation with deduplication if provided
      const executeOperation = async (): Promise<T> => {
        let result: T;
        let attemptAbortController: AbortController | undefined;
        
        if (timeoutPerAttempt !== undefined || operationAcceptsSignal) {
          // Create AbortController for this attempt (for timeout or operation cancellation)
          attemptAbortController = new AbortController();
          
          // Combine user signal with attempt signal
          if (signal) {
            const combinedAbortHandler = () => {
              attemptAbortController?.abort();
            };
            signal.addEventListener('abort', combinedAbortHandler);
            
            // Clean up handler when attempt completes
            const cleanup = () => {
              signal.removeEventListener('abort', combinedAbortHandler);
            };
            
            // Execute operation
            const operationPromise = operationAcceptsSignal
              ? (operation as (signal?: AbortSignal) => Promise<T>)(attemptAbortController.signal)
              : (operation as () => Promise<T>)();
            
            if (timeoutPerAttempt !== undefined) {
              // Race between operation and timeout
              const timeoutPromise = createTimeoutPromise(timeoutPerAttempt, attemptAbortController.signal);
              
              try {
                result = await Promise.race([operationPromise, timeoutPromise]);
                cleanup();
              } catch (error) {
                cleanup();
                // Abort operation if timeout occurred
                if (error && typeof error === 'object' && (error as Record<string, unknown>).name === 'TimeoutError') {
                  attemptAbortController.abort();
                }
                throw error;
              }
            } else {
              // No timeout, but operation accepts signal
              try {
                result = await operationPromise;
                cleanup();
              } catch (error) {
                cleanup();
                throw error;
              }
            }
          } else {
            // No user signal, just attempt signal
            const operationPromise = operationAcceptsSignal
              ? (operation as (signal?: AbortSignal) => Promise<T>)(attemptAbortController.signal)
              : (operation as () => Promise<T>)();
            
            if (timeoutPerAttempt !== undefined) {
              const timeoutPromise = createTimeoutPromise(timeoutPerAttempt, attemptAbortController.signal);
              
              try {
                result = await Promise.race([operationPromise, timeoutPromise]);
              } catch (error) {
                // Abort operation if timeout occurred
                if (error && typeof error === 'object' && (error as Record<string, unknown>).name === 'TimeoutError') {
                  attemptAbortController.abort();
                }
                throw error;
              }
            } else {
              result = await operationPromise;
            }
          }
        } else {
          // No timeout, operation doesn't accept signal
          result = await (operation as () => Promise<T>)();
        }
        
        return result;
      };
      
      // Use deduplication if provided
      let result: T;
      if (requestDeduplicator && requestId) {
        result = await requestDeduplicator.execute(requestId, executeOperation);
      } else {
        result = await executeOperation();
      }
      
      // Record operation to rate limiter
      if (rateLimiter && rateLimitKey) {
        rateLimiter.recordOperation(rateLimitKey);
      }
      
      // Validate result if validator provided
      if (validateResult) {
        const validation = validateResult(result, attempt, context);
        if (!validation.valid) {
          // Treat validation error as operation error
          throw validation.error;
        }
      }
      
      // Success - call onSuccess hook and return result
      const duration = performance.now() - startTime;
      safeInvokeCallback('onSuccess', onSuccess, [attempt, duration, context]);
      
      // Record success to circuit breaker
      circuitBreaker?.recordSuccess();
      
      return result;
    } catch (error) {
      lastError = error;
      errorHistory.push(error);
      
      // Check if we should retry this error
      const shouldRetryError = shouldRetry(error, attempt, context);
      
      // Record failure to circuit breaker
      circuitBreaker?.recordFailure();
      
      // If this is the last attempt or we shouldn't retry, give up
      if (attempt === maxAttempts || !shouldRetryError) {
        safeInvokeCallback('onGiveUp', onGiveUp, [attempt, error, errorHistory, context]);
        throw error;
      }
      
      // Calculate delay before retry
      let delayMs: number;
      
      // Check for Retry-After header (429 responses)
      const retryAfterHeader = extractRetryAfterHeader(error);
      const retryAfterDelay = parseRetryAfter(retryAfterHeader, maxDelay);
      
      if (retryAfterDelay !== null) {
        // Use Retry-After header value
        delayMs = retryAfterDelay;
      } else {
        // Use exponential backoff with jitter
        delayMs = calculateJitteredDelay(attempt, baseDelay, maxDelay, exponentialMultiplier);
      }
      
      // Add rate limit delay if we waited for rate limiter
      if (rateLimitDelay > 0) {
        delayMs = Math.max(delayMs, rateLimitDelay);
      }
      
      // Check max total duration before waiting
      if (maxTotalDuration !== undefined) {
        const elapsed = performance.now() - startTime;
        const remaining = maxTotalDuration - elapsed;
        if (remaining <= 0) {
          const timeoutError = new Error(`Operation exceeded max total duration of ${maxTotalDuration}ms`);
          timeoutError.name = 'TimeoutError';
          errorHistory.push(timeoutError);
          safeInvokeCallback('onGiveUp', onGiveUp, [attempt, timeoutError, errorHistory, context]);
          throw timeoutError;
        }
        // Cap delay at remaining time
        delayMs = Math.min(delayMs, remaining);
      }
      
      // Call onRetry hook
      safeInvokeCallback('onRetry', onRetry, [attempt, delayMs, error, context]);
      
      // Wait before retrying
      try {
        await delay(delayMs, signal);
      } catch (delayError) {
        // Delay was cancelled, throw cancellation error
        errorHistory.push(delayError);
        safeInvokeCallback('onGiveUp', onGiveUp, [attempt, delayError, errorHistory, context]);
        throw delayError;
      }
    }
  }
  
  // This should never be reached, but TypeScript needs it
  if (lastError) {
    safeInvokeCallback('onGiveUp', onGiveUp, [maxAttempts, lastError, errorHistory, context]);
  }
  throw lastError;
}
