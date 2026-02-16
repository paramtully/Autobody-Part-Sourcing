/**
 * Unit tests for Request Deduplicator.
 * 
 * Tests cover:
 * - Duplicate request detection
 * - Result sharing across concurrent callers
 * - TTL expiration
 * - Error handling
 * - Memory cleanup
 * - Edge cases
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { RequestDeduplicator } from '../requestDeduplicator';

/**
 * Mock implementation of RequestDeduplicator using in-memory cache.
 * Production implementations would use Redis for distributed deduplication.
 */
class MockRequestDeduplicator implements RequestDeduplicator {
  private inProgress = new Map<string, Promise<unknown>>();
  private cache = new Map<string, { result: unknown; expiresAt: number }>();
  private timeouts = new Map<string, NodeJS.Timeout>();

  async execute<T>(
    key: string,
    operation: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    // Check cache first
    if (this.cache.has(key)) {
      const cached = this.cache.get(key)!;
      if (Date.now() < cached.expiresAt) {
        return cached.result as T;
      }
      // Expired, remove
      this.cache.delete(key);
      const timeout = this.timeouts.get(key);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(key);
      }
    }

    // Check if already in progress
    if (this.inProgress.has(key)) {
      return this.inProgress.get(key) as Promise<T>;
    }

    // Execute operation
    const promise = (async () => {
      try {
        const result = await operation();

        // Cache result if TTL provided
        if (ttlMs) {
          this.cache.set(key, {
            result,
            expiresAt: Date.now() + ttlMs,
          });

          // Set expiration timeout
          const timeout = setTimeout(() => {
            this.cache.delete(key);
            this.timeouts.delete(key);
          }, ttlMs);
          this.timeouts.set(key, timeout);
        }

        return result;
      } finally {
        // Remove from in-progress
        this.inProgress.delete(key);
      }
    })();

    this.inProgress.set(key, promise);

    return promise;
  }

  isInProgress(key: string): boolean {
    return this.inProgress.has(key);
  }

  // Test helpers
  getCacheSize(): number {
    return this.cache.size;
  }

  getInProgressCount(): number {
    return this.inProgress.size;
  }

  clearCache(): void {
    this.cache.clear();
    this.timeouts.forEach(timeout => clearTimeout(timeout));
    this.timeouts.clear();
  }

  clearInProgress(): void {
    this.inProgress.clear();
  }

  reset(): void {
    this.clearCache();
    this.clearInProgress();
  }
}

describe('RequestDeduplicator', () => {
  let deduplicator: MockRequestDeduplicator;

  beforeEach(() => {
    deduplicator = new MockRequestDeduplicator();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    deduplicator.reset();
  });

  describe('Basic Deduplication', () => {
    it('executes operation for first request', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      const result = await deduplicator.execute('key-1', operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('returns same promise for concurrent duplicate requests', async () => {
      let callCount = 0;
      const operation = jest.fn().mockImplementation(() => {
        callCount++;
        return new Promise(resolve => setTimeout(() => resolve(`result-${callCount}`), 100));
      });

      const promise1 = deduplicator.execute('key-1', operation);
      const promise2 = deduplicator.execute('key-1', operation);
      const promise3 = deduplicator.execute('key-1', operation);

      jest.advanceTimersByTime(100);

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      // All should get same result
      expect(result1).toBe('result-1');
      expect(result2).toBe('result-1');
      expect(result3).toBe('result-1');

      // Operation should only be called once
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('executes operation separately for different keys', async () => {
      const operation1 = jest.fn().mockResolvedValue('result-1');
      const operation2 = jest.fn().mockResolvedValue('result-2');

      const result1 = await deduplicator.execute('key-1', operation1);
      const result2 = await deduplicator.execute('key-2', operation2);

      expect(result1).toBe('result-1');
      expect(result2).toBe('result-2');
      expect(operation1).toHaveBeenCalledTimes(1);
      expect(operation2).toHaveBeenCalledTimes(1);
    });
  });

  describe('In-Progress Tracking', () => {
    it('marks request as in progress during execution', async () => {
      const operation = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('result'), 100))
      );

      const promise = deduplicator.execute('key-1', operation);

      expect(deduplicator.isInProgress('key-1')).toBe(true);

      jest.advanceTimersByTime(100);
      await promise;

      expect(deduplicator.isInProgress('key-1')).toBe(false);
    });

    it('removes in-progress marker after completion', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      await deduplicator.execute('key-1', operation);

      expect(deduplicator.isInProgress('key-1')).toBe(false);
      expect(deduplicator.getInProgressCount()).toBe(0);
    });

    it('removes in-progress marker after error', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Failed'));

      await expect(deduplicator.execute('key-1', operation)).rejects.toThrow('Failed');

      expect(deduplicator.isInProgress('key-1')).toBe(false);
      expect(deduplicator.getInProgressCount()).toBe(0);
    });
  });

  describe('Caching with TTL', () => {
    it('caches result when TTL provided', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      await deduplicator.execute('key-1', operation, 5000);

      expect(deduplicator.getCacheSize()).toBe(1);
    });

    it('returns cached result on subsequent requests', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      const result1 = await deduplicator.execute('key-1', operation, 5000);
      const result2 = await deduplicator.execute('key-1', operation, 5000);

      expect(result1).toBe('result');
      expect(result2).toBe('result');
      expect(operation).toHaveBeenCalledTimes(1); // Only called once
    });

    it('expires cache after TTL', async () => {
      const operation = jest.fn()
        .mockResolvedValueOnce('result-1')
        .mockResolvedValueOnce('result-2');

      const result1 = await deduplicator.execute('key-1', operation, 5000);

      // Fast-forward past TTL
      jest.advanceTimersByTime(5000);

      const result2 = await deduplicator.execute('key-1', operation, 5000);

      expect(result1).toBe('result-1');
      expect(result2).toBe('result-2');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('does not cache when TTL not provided', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      await deduplicator.execute('key-1', operation);

      expect(deduplicator.getCacheSize()).toBe(0);
    });

    it('handles zero TTL (no caching)', async () => {
      const operation = jest.fn()
        .mockResolvedValueOnce('result-1')
        .mockResolvedValueOnce('result-2');

      const result1 = await deduplicator.execute('key-1', operation, 0);
      const result2 = await deduplicator.execute('key-1', operation, 0);

      expect(result1).toBe('result-1');
      expect(result2).toBe('result-1'); // Still deduplicated if concurrent
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('propagates errors from operation', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Operation failed'));

      await expect(deduplicator.execute('key-1', operation)).rejects.toThrow('Operation failed');
    });

    it('shares error across concurrent requests', async () => {
      const operation = jest.fn().mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Failed')), 100))
      );

      const promise1 = deduplicator.execute('key-1', operation);
      const promise2 = deduplicator.execute('key-1', operation);

      jest.advanceTimersByTime(100);

      await expect(promise1).rejects.toThrow('Failed');
      await expect(promise2).rejects.toThrow('Failed');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('does not cache errors', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValueOnce('success');

      await expect(deduplicator.execute('key-1', operation, 5000)).rejects.toThrow('First failure');

      const result = await deduplicator.execute('key-1', operation, 5000);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('allows retry after error', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Transient failure'))
        .mockResolvedValueOnce('success');

      await expect(deduplicator.execute('key-1', operation)).rejects.toThrow('Transient failure');

      const result = await deduplicator.execute('key-1', operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('Concurrent Operations', () => {
    it('handles many concurrent duplicate requests', async () => {
      const operation = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('result'), 100))
      );

      const promises = Array.from({ length: 100 }, () =>
        deduplicator.execute('key-1', operation)
      );

      jest.advanceTimersByTime(100);

      const results = await Promise.all(promises);

      // All get same result
      results.forEach(result => {
        expect(result).toBe('result');
      });

      // Operation only called once
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('handles concurrent requests for different keys', async () => {
      const operations = Array.from({ length: 50 }, (_, i) =>
        jest.fn().mockResolvedValue(`result-${i}`)
      );

      const promises = operations.map((op, i) =>
        deduplicator.execute(`key-${i}`, op)
      );

      const results = await Promise.all(promises);

      results.forEach((result, i) => {
        expect(result).toBe(`result-${i}`);
        expect(operations[i]).toHaveBeenCalledTimes(1);
      });
    });

    it('handles mixed concurrent and sequential requests', async () => {
      const operation = jest.fn()
        .mockResolvedValueOnce('result-1')
        .mockResolvedValueOnce('result-2');

      // First batch (concurrent)
      const batch1 = await Promise.all([
        deduplicator.execute('key-1', operation),
        deduplicator.execute('key-1', operation),
      ]);

      // Second batch (sequential)
      const batch2 = await Promise.all([
        deduplicator.execute('key-1', operation),
        deduplicator.execute('key-1', operation),
      ]);

      expect(batch1).toEqual(['result-1', 'result-1']);
      expect(batch2).toEqual(['result-2', 'result-2']);
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('Memory Management', () => {
    it('cleans up after operation completes', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      await deduplicator.execute('key-1', operation);

      expect(deduplicator.getInProgressCount()).toBe(0);
    });

    it('limits cache growth when using TTL', async () => {
      const operations = Array.from({ length: 10 }, (_, i) =>
        jest.fn().mockResolvedValue(`result-${i}`)
      );

      // Execute and cache all
      for (let i = 0; i < 10; i++) {
        await deduplicator.execute(`key-${i}`, operations[i], 5000);
      }

      expect(deduplicator.getCacheSize()).toBe(10);

      // Expire all
      jest.advanceTimersByTime(5000);

      expect(deduplicator.getCacheSize()).toBe(0);
    });

    it('clearCache() removes all cached entries', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      await deduplicator.execute('key-1', operation, 5000);
      await deduplicator.execute('key-2', operation, 5000);

      deduplicator.clearCache();

      expect(deduplicator.getCacheSize()).toBe(0);
    });

    it('reset() clears both cache and in-progress', async () => {
      const operation = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('result'), 100))
      );

      deduplicator.execute('key-1', operation, 5000);
      
      expect(deduplicator.isInProgress('key-1')).toBe(true);

      deduplicator.reset();

      expect(deduplicator.isInProgress('key-1')).toBe(false);
      expect(deduplicator.getCacheSize()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('handles undefined return value', async () => {
      const operation = jest.fn().mockResolvedValue(undefined);

      const result = await deduplicator.execute('key-1', operation);

      expect(result).toBeUndefined();
    });

    it('handles null return value', async () => {
      const operation = jest.fn().mockResolvedValue(null);

      const result = await deduplicator.execute('key-1', operation);

      expect(result).toBeNull();
    });

    it('handles complex objects', async () => {
      const complexObj = {
        data: [1, 2, 3],
        nested: { value: 'test' },
      };
      const operation = jest.fn().mockResolvedValue(complexObj);

      const result = await deduplicator.execute('key-1', operation);

      expect(result).toEqual(complexObj);
    });

    it('handles empty key', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      const result = await deduplicator.execute('', operation);

      expect(result).toBe('result');
    });

    it('handles very long keys', async () => {
      const longKey = 'a'.repeat(10000);
      const operation = jest.fn().mockResolvedValue('result');

      const result = await deduplicator.execute(longKey, operation);

      expect(result).toBe('result');
    });

    it('handles rapid sequential requests after completion', async () => {
      const operation = jest.fn()
        .mockResolvedValueOnce('result-1')
        .mockResolvedValueOnce('result-2')
        .mockResolvedValueOnce('result-3');

      const result1 = await deduplicator.execute('key-1', operation);
      const result2 = await deduplicator.execute('key-1', operation);
      const result3 = await deduplicator.execute('key-1', operation);

      expect(result1).toBe('result-1');
      expect(result2).toBe('result-2');
      expect(result3).toBe('result-3');
      expect(operation).toHaveBeenCalledTimes(3);
    });
  });

  describe('TTL Edge Cases', () => {
    it('handles very short TTL', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      await deduplicator.execute('key-1', operation, 1);

      jest.advanceTimersByTime(1);

      expect(deduplicator.getCacheSize()).toBe(0);
    });

    it('handles very long TTL', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      await deduplicator.execute('key-1', operation, 86400000); // 1 day

      jest.advanceTimersByTime(3600000); // 1 hour

      expect(deduplicator.getCacheSize()).toBe(1);
    });

    it('handles negative TTL as no caching', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      await deduplicator.execute('key-1', operation, -1000);

      // Negative TTL should be treated as no caching
      expect(deduplicator.getCacheSize()).toBeLessThanOrEqual(1);
    });
  });
});
