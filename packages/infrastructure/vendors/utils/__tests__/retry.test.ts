/**
 * Unit tests for network retry utility.
 * 
 * Tests cover:
 * - Exponential backoff and jitter
 * - Retry-After header parsing
 * - Timeout behavior
 * - AbortSignal cancellation
 * - Error classification
 * - Context propagation
 * - Edge cases
 * - Logging hooks
 * - Error type mapping
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  retryAsync,
  calculateJitteredDelay,
  parseRetryAfter,
  defaultShouldRetry,
  isNetworkError,
  isHttpError,
  extractStatusCode,
  classifyErrorType,
  mapToRetryableError,
  mapToNonRetryableError,
  type RetryOptions,
} from '../retry';
import type { CircuitBreaker } from '../circuitBreaker';
import type { RequestDeduplicator } from '../requestDeduplicator';
import type { RateLimiter } from '../rateLimiter';

describe('calculateJitteredDelay', () => {
  it('calculates exponential delay correctly', () => {
    const baseDelay = 1000;
    const maxDelay = 30000;
    const multiplier = 2;
    
    // Attempt 1: baseDelay * 2^0 = 1000
    const delay1 = calculateJitteredDelay(1, baseDelay, maxDelay, multiplier);
    expect(delay1).toBeGreaterThanOrEqual(0);
    expect(delay1).toBeLessThanOrEqual(1000);
    
    // Attempt 2: baseDelay * 2^1 = 2000
    const delay2 = calculateJitteredDelay(2, baseDelay, maxDelay, multiplier);
    expect(delay2).toBeGreaterThanOrEqual(0);
    expect(delay2).toBeLessThanOrEqual(2000);
    
    // Attempt 3: baseDelay * 2^2 = 4000
    const delay3 = calculateJitteredDelay(3, baseDelay, maxDelay, multiplier);
    expect(delay3).toBeGreaterThanOrEqual(0);
    expect(delay3).toBeLessThanOrEqual(4000);
  });
  
  it('caps delay at maxDelay', () => {
    const baseDelay = 1000;
    const maxDelay = 5000;
    const multiplier = 2;
    
    // Attempt 10: baseDelay * 2^9 = 512000, but should cap at 5000
    const delay = calculateJitteredDelay(10, baseDelay, maxDelay, multiplier);
    expect(delay).toBeLessThanOrEqual(maxDelay);
  });
  
  it('produces different delays on multiple calls (jitter)', () => {
    const baseDelay = 1000;
    const maxDelay = 30000;
    const multiplier = 2;
    
    const delays = new Set<number>();
    for (let i = 0; i < 10; i++) {
      delays.add(calculateJitteredDelay(2, baseDelay, maxDelay, multiplier));
    }
    
    // With jitter, we should get some variation (not all same value)
    // Note: There's a small chance all values could be the same, but very unlikely
    expect(delays.size).toBeGreaterThan(1);
  });
});

describe('parseRetryAfter', () => {
  const maxDelay = 30000;
  
  it('parses integer seconds format', () => {
    expect(parseRetryAfter('120', maxDelay)).toBe(120000);
    expect(parseRetryAfter('5', maxDelay)).toBe(5000);
    expect(parseRetryAfter('0', maxDelay)).toBe(0);
  });
  
  it('parses HTTP-date format', () => {
    const futureDate = new Date(Date.now() + 60000); // 60 seconds in future
    const httpDate = futureDate.toUTCString();
    const result = parseRetryAfter(httpDate, maxDelay);
    expect(result).toBeGreaterThan(50000);
    expect(result).toBeLessThan(70000);
  });
  
  it('caps result at maxDelay', () => {
    expect(parseRetryAfter('1000', maxDelay)).toBe(maxDelay); // 1000 seconds > 30000ms
    expect(parseRetryAfter('50', maxDelay)).toBe(50000); // 50 seconds = 50000ms > 30000ms, so capped
  });
  
  it('returns null for invalid values', () => {
    expect(parseRetryAfter(null, maxDelay)).toBeNull();
    expect(parseRetryAfter(undefined, maxDelay)).toBeNull();
    expect(parseRetryAfter('', maxDelay)).toBeNull();
    expect(parseRetryAfter('invalid', maxDelay)).toBeNull();
    expect(parseRetryAfter('abc123', maxDelay)).toBeNull();
  });
  
  it('returns null for HTTP-date in the past', () => {
    const pastDate = new Date(Date.now() - 60000);
    const httpDate = pastDate.toUTCString();
    expect(parseRetryAfter(httpDate, maxDelay)).toBeNull();
  });
  
  it('handles whitespace in integer format', () => {
    expect(parseRetryAfter('  120  ', maxDelay)).toBe(120000);
  });
});

describe('isNetworkError', () => {
  it('detects Node.js network error codes', () => {
    expect(isNetworkError({ code: 'ECONNRESET' })).toBe(true);
    expect(isNetworkError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isNetworkError({ code: 'ENOTFOUND' })).toBe(true);
    expect(isNetworkError({ code: 'ECONNREFUSED' })).toBe(true);
  });
  
  it('detects network error names', () => {
    expect(isNetworkError({ name: 'TimeoutError' })).toBe(true);
    expect(isNetworkError({ name: 'NetworkError' })).toBe(true);
    expect(isNetworkError({ name: 'AbortError' })).toBe(true);
  });
  
  it('detects network errors in message', () => {
    expect(isNetworkError({ message: 'Network request failed' })).toBe(true);
    expect(isNetworkError({ message: 'Connection timeout' })).toBe(true);
    expect(isNetworkError({ message: 'ECONNRESET error occurred' })).toBe(true);
  });
  
  it('returns false for non-network errors', () => {
    expect(isNetworkError({ message: 'Invalid input' })).toBe(false);
    expect(isNetworkError({ status: 400 })).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});

describe('extractStatusCode', () => {
  it('extracts status from error.status', () => {
    expect(extractStatusCode({ status: 429 })).toBe(429);
    expect(extractStatusCode({ status: 500 })).toBe(500);
  });
  
  it('extracts status from error.statusCode', () => {
    expect(extractStatusCode({ statusCode: 404 })).toBe(404);
  });
  
  it('extracts status from error.response.status (axios)', () => {
    expect(extractStatusCode({ response: { status: 401 } })).toBe(401);
  });
  
  it('extracts status from error.response.statusCode', () => {
    expect(extractStatusCode({ response: { statusCode: 403 } })).toBe(403);
  });
  
  it('returns null for errors without status codes', () => {
    expect(extractStatusCode({ message: 'Error' })).toBeNull();
    expect(extractStatusCode(null)).toBeNull();
    expect(extractStatusCode(undefined)).toBeNull();
  });
});

describe('isHttpError', () => {
  it('returns true for errors with status codes', () => {
    expect(isHttpError({ status: 200 })).toBe(true);
    expect(isHttpError({ statusCode: 404 })).toBe(true);
    expect(isHttpError({ response: { status: 500 } })).toBe(true);
  });
  
  it('returns false for errors without status codes', () => {
    expect(isHttpError({ message: 'Error' })).toBe(false);
    expect(isHttpError(null)).toBe(false);
  });
});

describe('defaultShouldRetry', () => {
  it('returns true for network errors', () => {
    expect(defaultShouldRetry({ code: 'ECONNRESET' }, 1)).toBe(true);
    expect(defaultShouldRetry({ code: 'ETIMEDOUT' }, 1)).toBe(true);
    expect(defaultShouldRetry({ name: 'TimeoutError' }, 1)).toBe(true);
  });
  
  it('returns true for 429 (rate limit)', () => {
    expect(defaultShouldRetry({ status: 429 }, 1)).toBe(true);
    expect(defaultShouldRetry({ statusCode: 429 }, 1)).toBe(true);
  });
  
  it('returns true for 5xx (server errors)', () => {
    expect(defaultShouldRetry({ status: 500 }, 1)).toBe(true);
    expect(defaultShouldRetry({ status: 503 }, 1)).toBe(true);
    expect(defaultShouldRetry({ statusCode: 502 }, 1)).toBe(true);
  });
  
  it('returns false for 400 (bad request)', () => {
    expect(defaultShouldRetry({ status: 400 }, 1)).toBe(false);
  });
  
  it('returns false for 401 (unauthorized)', () => {
    expect(defaultShouldRetry({ status: 401 }, 1)).toBe(false);
  });
  
  it('returns false for 403 (forbidden)', () => {
    expect(defaultShouldRetry({ status: 403 }, 1)).toBe(false);
  });
  
  it('returns false for 404 (not found) for API integrations', () => {
    expect(defaultShouldRetry({ status: 404 }, 1)).toBe(false);
    expect(defaultShouldRetry({ status: 404 }, 1, { integrationType: 'API' })).toBe(false);
  });
  
  it('returns true for 404 (not found) for SCRAPER integrations', () => {
    expect(defaultShouldRetry({ status: 404 }, 1, { integrationType: 'SCRAPER' })).toBe(true);
  });
  
  it('returns false for unknown errors', () => {
    expect(defaultShouldRetry({ message: 'Unknown error' }, 1)).toBe(false);
  });
});

describe('classifyErrorType', () => {
  it('classifies network errors as NETWORK_ERROR', () => {
    expect(classifyErrorType({ code: 'ECONNRESET' })).toBe('NETWORK_ERROR');
    expect(classifyErrorType({ name: 'TimeoutError' })).toBe('TIMEOUT');
  });
  
  it('classifies 429 as RATE_LIMIT', () => {
    expect(classifyErrorType({ status: 429 })).toBe('RATE_LIMIT');
  });
  
  it('classifies 5xx as SERVER_ERROR', () => {
    expect(classifyErrorType({ status: 500 })).toBe('SERVER_ERROR');
    expect(classifyErrorType({ status: 503 })).toBe('SERVER_ERROR');
  });
  
  it('classifies 401/403 as AUTH_ERROR', () => {
    expect(classifyErrorType({ status: 401 })).toBe('AUTH_ERROR');
    expect(classifyErrorType({ status: 403 })).toBe('AUTH_ERROR');
  });
  
  it('classifies 400 as INVALID_REQUEST', () => {
    expect(classifyErrorType({ status: 400 })).toBe('INVALID_REQUEST');
  });
  
  it('classifies 404 as NOT_FOUND', () => {
    expect(classifyErrorType({ status: 404 })).toBe('NOT_FOUND');
  });
  
  it('returns null for unclassifiable errors', () => {
    expect(classifyErrorType({ message: 'Unknown' })).toBeNull();
  });
});

describe('mapToRetryableError', () => {
  it('maps retryable errors correctly', () => {
    expect(mapToRetryableError({ code: 'ECONNRESET' })).toBe('NETWORK_ERROR');
    expect(mapToRetryableError({ status: 429 })).toBe('RATE_LIMIT');
    expect(mapToRetryableError({ status: 500 })).toBe('SERVER_ERROR');
    expect(mapToRetryableError({ name: 'TimeoutError' })).toBe('TIMEOUT');
  });
  
  it('returns null for non-retryable errors', () => {
    expect(mapToRetryableError({ status: 400 })).toBeNull();
    expect(mapToRetryableError({ status: 401 })).toBeNull();
    expect(mapToRetryableError({ status: 404 })).toBeNull();
  });
});

describe('mapToNonRetryableError', () => {
  it('maps non-retryable errors correctly', () => {
    expect(mapToNonRetryableError({ status: 400 })).toBe('INVALID_REQUEST');
    expect(mapToNonRetryableError({ status: 401 })).toBe('AUTH_ERROR');
    expect(mapToNonRetryableError({ status: 403 })).toBe('AUTH_ERROR');
    expect(mapToNonRetryableError({ status: 404 })).toBe('NOT_FOUND');
  });
  
  it('returns null for retryable errors', () => {
    expect(mapToNonRetryableError({ code: 'ECONNRESET' })).toBeNull();
    expect(mapToNonRetryableError({ status: 429 })).toBeNull();
    expect(mapToNonRetryableError({ status: 500 })).toBeNull();
  });
});

describe('retryAsync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  it('succeeds on first attempt', async () => {
    const operation = jest.fn().mockResolvedValue('success');
    
    const result = await retryAsync(operation, {
      shouldRetry: () => false,
    });
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });
  
  it('retries on retryable errors and succeeds', async () => {
    let attempt = 0;
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        throw { code: 'ECONNRESET' };
      }
      return Promise.resolve('success');
    });
    
    const options: RetryOptions = {
      baseDelay: 100,
      maxAttempts: 3,
      shouldRetry: (error) => isNetworkError(error),
    };
    
    const promise = retryAsync(operation, options);
    
    // Fast-forward past first delay
    jest.advanceTimersByTime(100);
    
    const result = await promise;
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });
  
  it('throws last error when max attempts exhausted', async () => {
    const error = { code: 'ECONNRESET' };
    const operation = jest.fn().mockRejectedValue(error);
    
    const options: RetryOptions = {
      baseDelay: 100,
      maxAttempts: 3,
      shouldRetry: () => true,
    };
    
    const promise = retryAsync(operation, options);
    
    // Fast-forward past all delays
    jest.advanceTimersByTime(1000);
    
    await expect(promise).rejects.toEqual(error);
    expect(operation).toHaveBeenCalledTimes(3);
  });
  
  it('does not retry on non-retryable errors', async () => {
    const error = { status: 400 };
    const operation = jest.fn().mockRejectedValue(error);
    
    const options: RetryOptions = {
      shouldRetry: () => false,
    };
    
    const promise = retryAsync(operation, options);
    
    await expect(promise).rejects.toEqual(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  
  it('validates maxDelay >= baseDelay', async () => {
    const operation = jest.fn().mockResolvedValue('success');
    
    await expect(
      retryAsync(operation, {
        baseDelay: 1000,
        maxDelay: 500,
        shouldRetry: () => false,
      })
    ).rejects.toThrow('maxDelay (500) must be >= baseDelay (1000)');
  });
  
  it('validates maxAttempts >= 1', async () => {
    const operation = jest.fn().mockResolvedValue('success');
    
    await expect(
      retryAsync(operation, {
        maxAttempts: 0,
        shouldRetry: () => false,
      })
    ).rejects.toThrow('maxAttempts (0) must be >= 1');
  });
  
  it('handles undefined and null return values as success', async () => {
    const operation1 = jest.fn().mockResolvedValue(undefined);
    const operation2 = jest.fn().mockResolvedValue(null);
    
    const result1 = await retryAsync(operation1, { shouldRetry: () => false });
    const result2 = await retryAsync(operation2, { shouldRetry: () => false });
    
    expect(result1).toBeUndefined();
    expect(result2).toBeNull();
  });
  
  it('respects Retry-After header for 429 responses', async () => {
    let attempt = 0;
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        const error: any = { status: 429 };
        error.response = {
          headers: {
            'retry-after': '200', // 200 seconds
          },
        };
        throw error;
      }
      return Promise.resolve('success');
    });
    
    const options: RetryOptions = {
      baseDelay: 100,
      maxDelay: 30000,
      maxAttempts: 3,
      shouldRetry: () => true,
    };
    
    const promise = retryAsync(operation, options);
    
    // Fast-forward past Retry-After delay (capped at maxDelay)
    jest.advanceTimersByTime(30000);
    
    const result = await promise;
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });
  
  it('applies per-attempt timeout', async () => {
    const operation = jest.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );
    
    const options: RetryOptions = {
      timeoutPerAttempt: 100,
      maxAttempts: 2,
      shouldRetry: (error) => {
        return error && typeof error === 'object' && (error as any).name === 'TimeoutError';
      },
    };
    
    const promise = retryAsync(operation, options);
    
    // Fast-forward to trigger timeout
    jest.advanceTimersByTime(100);
    
    await expect(promise).rejects.toThrow('Operation timed out');
    expect(operation).toHaveBeenCalledTimes(2);
  });
  
  it('enforces max total duration', async () => {
    let attempt = 0;
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      throw { code: 'ECONNRESET' };
    });
    
    const options: RetryOptions = {
      baseDelay: 100,
      maxTotalDuration: 150,
      maxAttempts: 5,
      shouldRetry: () => true,
    };
    
    const promise = retryAsync(operation, options);
    
    // Fast-forward past max total duration
    jest.advanceTimersByTime(200);
    
    await expect(promise).rejects.toThrow('exceeded max total duration');
  });
  
  it('handles AbortSignal cancellation before operation', async () => {
    const controller = new AbortController();
    controller.abort();
    
    const operation = jest.fn().mockResolvedValue('success');
    
    await expect(
      retryAsync(operation, {
        signal: controller.signal,
        shouldRetry: () => false,
      })
    ).rejects.toThrow('Operation cancelled');
    
    expect(operation).not.toHaveBeenCalled();
  });
  
  it('handles AbortSignal cancellation during delay', async () => {
    const controller = new AbortController();
    let attempt = 0;
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        throw { code: 'ECONNRESET' };
      }
      return Promise.resolve('success');
    });
    
    const options: RetryOptions = {
      baseDelay: 1000,
      maxAttempts: 3,
      signal: controller.signal,
      shouldRetry: () => true,
    };
    
    const promise = retryAsync(operation, options);
    
    // Fast-forward a bit, then abort
    jest.advanceTimersByTime(500);
    controller.abort();
    jest.advanceTimersByTime(500);
    
    await expect(promise).rejects.toThrow('Operation cancelled');
  });
  
  it('calls onRetry hook with correct parameters', async () => {
    const onRetry = jest.fn();
    let attempt = 0;
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        throw { code: 'ECONNRESET' };
      }
      return Promise.resolve('success');
    });
    
    const context = { vendorId: 'test-vendor' };
    const options: RetryOptions<typeof context> = {
      baseDelay: 100,
      maxAttempts: 3,
      shouldRetry: () => true,
      onRetry,
      context,
    };
    
    const promise = retryAsync(operation, options);
    jest.advanceTimersByTime(100);
    
    await promise;
    
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Number), { code: 'ECONNRESET' }, context);
  });
  
  it('calls onGiveUp hook when retries exhausted', async () => {
    const onGiveUp = jest.fn();
    const error = { code: 'ECONNRESET' };
    const operation = jest.fn().mockRejectedValue(error);
    
    const context = { vendorId: 'test-vendor' };
    const options: RetryOptions<typeof context> = {
      baseDelay: 100,
      maxAttempts: 2,
      shouldRetry: () => true,
      onGiveUp,
      context,
    };
    
    const promise = retryAsync(operation, options);
    jest.advanceTimersByTime(1000);
    
    await expect(promise).rejects.toEqual(error);
    
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith(2, error, expect.any(Array), context);
  });
  
  it('calls onSuccess hook with correct parameters', async () => {
    const onSuccess = jest.fn();
    const operation = jest.fn().mockResolvedValue('success');
    
    const context = { vendorId: 'test-vendor' };
    const options: RetryOptions<typeof context> = {
      shouldRetry: () => false,
      onSuccess,
      context,
    };
    
    await retryAsync(operation, options);
    
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(1, expect.any(Number), context);
  });
  
  it('passes context to shouldRetry function', async () => {
    const shouldRetry = jest.fn().mockReturnValue(false);
    const operation = jest.fn().mockResolvedValue('success');
    
    const context = { integrationType: 'SCRAPER' as const };
    const options: RetryOptions<typeof context> = {
      shouldRetry,
      context,
    };
    
    await retryAsync(operation, options);
    
    expect(shouldRetry).toHaveBeenCalledWith(undefined, 1, context);
  });
  
  it('does not pass context to operation', async () => {
    const operation = jest.fn().mockResolvedValue('success');
    const context = { vendorId: 'test-vendor' };
    
    await retryAsync(operation, {
      shouldRetry: () => false,
      context,
    });
    
    // Operation should be called with no arguments
    expect(operation).toHaveBeenCalledWith();
  });
  
  it('handles callback errors without masking original error', async () => {
    const onRetry = jest.fn().mockImplementation(() => {
      throw new Error('Callback error');
    });
    const onCallbackError = jest.fn();
    let attempt = 0;
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        throw { code: 'ECONNRESET' };
      }
      return Promise.resolve('success');
    });
    
    const options: RetryOptions = {
      baseDelay: 100,
      maxAttempts: 3,
      shouldRetry: () => true,
      onRetry,
      onCallbackError,
    };
    
    const promise = retryAsync(operation, options);
    jest.advanceTimersByTime(100);
    
    const result = await promise;
    
    expect(result).toBe('success');
    expect(onRetry).toHaveBeenCalled();
    expect(onCallbackError).toHaveBeenCalledWith('onRetry', expect.any(Error), undefined);
  });
  
  it('tracks error history across retry attempts', async () => {
    const onGiveUp = jest.fn();
    const error1 = { code: 'ECONNRESET' };
    const error2 = { code: 'ETIMEDOUT' };
    let attempt = 0;
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        throw error1;
      }
      if (attempt === 2) {
        throw error2;
      }
      return Promise.resolve('success');
    });
    
    const options: RetryOptions = {
      baseDelay: 100,
      maxAttempts: 2,
      shouldRetry: () => true,
      onGiveUp,
    };
    
    const promise = retryAsync(operation, options);
    jest.advanceTimersByTime(200);
    
    await expect(promise).rejects.toEqual(error2);
    
    expect(onGiveUp).toHaveBeenCalledWith(2, error2, [error1, error2], undefined);
  });
  
  it('handles AbortSignal in operation when operationAcceptsSignal is true', async () => {
    const controller = new AbortController();
    const operation = jest.fn().mockImplementation((signal?: AbortSignal) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (signal?.aborted) {
            reject(new Error('Operation aborted'));
          } else {
            resolve('success');
          }
        }, 100);
        
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Operation aborted'));
          });
        }
      });
    });
    
    const options: RetryOptions = {
      operationAcceptsSignal: true,
      timeoutPerAttempt: 50,
      maxAttempts: 2,
      shouldRetry: (error) => {
        return error && typeof error === 'object' && (error as any).name === 'TimeoutError';
      },
    };
    
    const promise = retryAsync(operation, options);
    jest.advanceTimersByTime(50);
    
    await expect(promise).rejects.toThrow('Operation timed out');
    expect(operation).toHaveBeenCalled();
  });
  
  it('integrates with circuit breaker - blocks when open', async () => {
    const circuitBreaker: CircuitBreaker = {
      isOpen: jest.fn().mockReturnValue(true),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      getState: jest.fn().mockReturnValue('open'),
    };
    
    const operation = jest.fn().mockResolvedValue('success');
    
    await expect(
      retryAsync(operation, {
        circuitBreaker,
        shouldRetry: () => false,
      })
    ).rejects.toThrow('Circuit breaker is open');
    
    expect(operation).not.toHaveBeenCalled();
    expect(circuitBreaker.isOpen).toHaveBeenCalled();
  });
  
  it('integrates with circuit breaker - records success and failure', async () => {
    const circuitBreaker: CircuitBreaker = {
      isOpen: jest.fn().mockReturnValue(false),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      getState: jest.fn().mockReturnValue('closed'),
    };
    
    let attempt = 0;
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        throw { code: 'ECONNRESET' };
      }
      return Promise.resolve('success');
    });
    
    const options: RetryOptions = {
      baseDelay: 100,
      maxAttempts: 3,
      circuitBreaker,
      shouldRetry: () => true,
    };
    
    const promise = retryAsync(operation, options);
    jest.advanceTimersByTime(100);
    
    await promise;
    
    expect(circuitBreaker.recordFailure).toHaveBeenCalledTimes(1);
    expect(circuitBreaker.recordSuccess).toHaveBeenCalledTimes(1);
  });
  
  it('integrates with request deduplicator', async () => {
    let operationCallCount = 0;
    const operation = jest.fn().mockImplementation(() => {
      operationCallCount++;
      return Promise.resolve(`result-${operationCallCount}`);
    });
    
    const deduplicator: RequestDeduplicator = {
      execute: jest.fn().mockImplementation(async (key, op) => {
        return op();
      }),
      isInProgress: jest.fn().mockReturnValue(false),
    };
    
    const options: RetryOptions = {
      requestDeduplicator: deduplicator,
      requestId: 'test-request-1',
      shouldRetry: () => false,
    };
    
    const result = await retryAsync(operation, options);
    
    expect(deduplicator.execute).toHaveBeenCalledWith('test-request-1', expect.any(Function), undefined);
    expect(result).toBe('result-1');
  });
  
  it('integrates with rate limiter', async () => {
    const rateLimiter: RateLimiter = {
      waitIfNeeded: jest.fn().mockResolvedValue(0),
      recordOperation: jest.fn(),
    };
    
    const operation = jest.fn().mockResolvedValue('success');
    
    const options: RetryOptions = {
      rateLimiter,
      rateLimitKey: 'vendor-1',
      shouldRetry: () => false,
    };
    
    await retryAsync(operation, options);
    
    expect(rateLimiter.waitIfNeeded).toHaveBeenCalledWith('vendor-1');
    expect(rateLimiter.recordOperation).toHaveBeenCalledWith('vendor-1');
  });
  
  it('waits for rate limiter when limit exceeded', async () => {
    const rateLimiter: RateLimiter = {
      waitIfNeeded: jest.fn().mockResolvedValue(500),
      recordOperation: jest.fn(),
    };
    
    const operation = jest.fn().mockResolvedValue('success');
    
    const options: RetryOptions = {
      rateLimiter,
      rateLimitKey: 'vendor-1',
      shouldRetry: () => false,
    };
    
    await retryAsync(operation, options);
    
    expect(rateLimiter.waitIfNeeded).toHaveBeenCalledWith('vendor-1');
  });
  
  it('validates result and retries on validation failure', async () => {
    let attempt = 0;
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      return Promise.resolve(attempt === 1 ? null : 'valid-result');
    });
    
    const validateResult = jest.fn().mockImplementation((result) => {
      if (result === null) {
        return { valid: false, error: new Error('Invalid result: null') };
      }
      return { valid: true };
    });
    
    const options: RetryOptions<string> = {
      baseDelay: 100,
      maxAttempts: 3,
      shouldRetry: () => true,
      validateResult,
    };
    
    const promise = retryAsync(operation, options);
    jest.advanceTimersByTime(100);
    
    const result = await promise;
    
    expect(result).toBe('valid-result');
    expect(validateResult).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledTimes(2);
  });
  
  it('handles Retry-After with zero or negative delays', () => {
    const maxDelay = 30000;
    expect(parseRetryAfter('0', maxDelay)).toBe(0);
    expect(parseRetryAfter('-1', maxDelay)).toBeNull();
    
    const pastDate = new Date(Date.now() - 1000);
    const pastDateString = pastDate.toUTCString();
    expect(parseRetryAfter(pastDateString, maxDelay)).toBeNull();
  });
  
  it('handles HTTP-date format in Retry-After header', async () => {
    let attempt = 0;
    const futureDate = new Date(Date.now() + 5000); // 5 seconds in future
    const httpDate = futureDate.toUTCString();
    
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        const error: any = { status: 429 };
        error.response = {
          headers: {
            'retry-after': httpDate,
          },
        };
        throw error;
      }
      return Promise.resolve('success');
    });
    
    const options: RetryOptions = {
      baseDelay: 100,
      maxDelay: 30000,
      maxAttempts: 3,
      shouldRetry: () => true,
    };
    
    const promise = retryAsync(operation, options);
    
    // Fast-forward past HTTP-date delay
    jest.advanceTimersByTime(5000);
    
    const result = await promise;
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });
  
  it('falls back to exponential backoff when Retry-After is invalid', async () => {
    let attempt = 0;
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        const error: any = { status: 429 };
        error.response = {
          headers: {
            'retry-after': 'invalid',
          },
        };
        throw error;
      }
      return Promise.resolve('success');
    });
    
    const options: RetryOptions = {
      baseDelay: 100,
      maxDelay: 30000,
      maxAttempts: 3,
      shouldRetry: () => true,
    };
    
    const promise = retryAsync(operation, options);
    
    // Fast-forward past exponential backoff delay
    jest.advanceTimersByTime(200);
    
    const result = await promise;
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });
  
  it('caps Retry-After delay at maxDelay', async () => {
    let attempt = 0;
    const operation = jest.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        const error: any = { status: 429 };
        error.response = {
          headers: {
            'retry-after': '1000', // 1000 seconds = 1000000ms, but maxDelay is 30000ms
          },
        };
        throw error;
      }
      return Promise.resolve('success');
    });
    
    const options: RetryOptions = {
      baseDelay: 100,
      maxDelay: 30000,
      maxAttempts: 3,
      shouldRetry: () => true,
    };
    
    const promise = retryAsync(operation, options);
    
    // Fast-forward past capped delay
    jest.advanceTimersByTime(30000);
    
    const result = await promise;
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
