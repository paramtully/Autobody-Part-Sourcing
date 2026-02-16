/**
 * Unit tests for Rate Limiter.
 * 
 * Tests cover:
 * - Token bucket algorithm
 * - Request rate enforcement
 * - Window-based limiting
 * - Concurrent request handling
 * - Multiple key isolation
 * - Edge cases
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { RateLimiter } from '../rateLimiter';

/**
 * Mock implementation of RateLimiter using token bucket algorithm.
 * Production implementations would use Redis for distributed rate limiting.
 */
class MockTokenBucketRateLimiter implements RateLimiter {
  private buckets = new Map<string, {
    tokens: number;
    lastRefill: number;
  }>();

  constructor(
    private readonly maxTokens: number = 60, // Max requests per window
    private readonly refillRate: number = 60, // Tokens per minute
    private readonly windowMs: number = 60000 // 1 minute window
  ) {}

  async waitIfNeeded(key: string): Promise<number> {
    const bucket = this.getBucket(key);
    this.refillBucket(bucket);

    if (bucket.tokens >= 1) {
      // Rate limit not exceeded, consume token
      bucket.tokens -= 1;
      return 0; // No wait needed
    }

    // Rate limit exceeded, calculate wait time
    const tokensNeeded = 1;
    const refillInterval = this.windowMs / this.refillRate;
    const waitMs = Math.ceil(tokensNeeded * refillInterval);

    // Simulate waiting
    await new Promise(resolve => setTimeout(resolve, waitMs));

    this.refillBucket(bucket);
    bucket.tokens -= 1;

    return waitMs;
  }

  recordOperation(key: string): void {
    // In this implementation, waitIfNeeded already consumes the token
    // This method could be used for post-operation tracking if needed
  }

  private getBucket(key: string) {
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        tokens: this.maxTokens,
        lastRefill: Date.now(),
      });
    }
    return this.buckets.get(key)!;
  }

  private refillBucket(bucket: { tokens: number; lastRefill: number }): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = (elapsed / this.windowMs) * this.refillRate;

    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  // Test helpers
  getTokenCount(key: string): number {
    const bucket = this.getBucket(key);
    this.refillBucket(bucket);
    return bucket.tokens;
  }

  reset(): void {
    this.buckets.clear();
  }
}

describe('RateLimiter', () => {
  let rateLimiter: MockTokenBucketRateLimiter;

  beforeEach(() => {
    rateLimiter = new MockTokenBucketRateLimiter(60, 60, 60000);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Basic Rate Limiting', () => {
    it('allows requests below rate limit', async () => {
      const delay = await rateLimiter.waitIfNeeded('vendor-1');

      expect(delay).toBe(0);
    });

    it('allows multiple requests below limit', async () => {
      for (let i = 0; i < 10; i++) {
        const delay = await rateLimiter.waitIfNeeded('vendor-1');
        expect(delay).toBe(0);
      }
    });

    it('enforces rate limit when exceeded', async () => {
      // Exhaust tokens
      for (let i = 0; i < 60; i++) {
        await rateLimiter.waitIfNeeded('vendor-1');
      }

      // Next request should be delayed
      const promise = rateLimiter.waitIfNeeded('vendor-1');
      jest.advanceTimersByTime(1000); // Wait for refill

      const delay = await promise;
      expect(delay).toBeGreaterThan(0);
    });

    it('returns correct wait time when rate limited', async () => {
      // Exhaust tokens
      for (let i = 0; i < 60; i++) {
        await rateLimiter.waitIfNeeded('vendor-1');
      }

      const promise = rateLimiter.waitIfNeeded('vendor-1');
      jest.advanceTimersByTime(1000);

      const delay = await promise;
      expect(delay).toBeGreaterThanOrEqual(900); // ~1000ms per token at 60/min
      expect(delay).toBeLessThanOrEqual(1100);
    });
  });

  describe('Token Bucket Refill', () => {
    it('refills tokens over time', async () => {
      // Consume some tokens
      for (let i = 0; i < 30; i++) {
        await rateLimiter.waitIfNeeded('vendor-1');
      }

      const tokensBefore = rateLimiter.getTokenCount('vendor-1');

      // Wait for refill (half window = 30 tokens)
      jest.advanceTimersByTime(30000);

      const tokensAfter = rateLimiter.getTokenCount('vendor-1');

      expect(tokensAfter).toBeGreaterThan(tokensBefore);
    });

    it('caps tokens at maximum', async () => {
      jest.advanceTimersByTime(120000); // 2 minutes (should refill 120 tokens, but capped at 60)

      const tokens = rateLimiter.getTokenCount('vendor-1');

      expect(tokens).toBeLessThanOrEqual(60);
    });

    it('refills at correct rate', async () => {
      // Consume all tokens
      for (let i = 0; i < 60; i++) {
        await rateLimiter.waitIfNeeded('vendor-1');
      }

      // Wait for 1/4 window = 15 tokens
      jest.advanceTimersByTime(15000);

      const tokens = rateLimiter.getTokenCount('vendor-1');

      expect(tokens).toBeGreaterThanOrEqual(14);
      expect(tokens).toBeLessThanOrEqual(16);
    });
  });

  describe('Multi-Key Isolation', () => {
    it('tracks different keys independently', async () => {
      await rateLimiter.waitIfNeeded('vendor-1');
      await rateLimiter.waitIfNeeded('vendor-2');

      const tokens1 = rateLimiter.getTokenCount('vendor-1');
      const tokens2 = rateLimiter.getTokenCount('vendor-2');

      expect(tokens1).toBeLessThan(60);
      expect(tokens2).toBeLessThan(60);
    });

    it('rate limiting one key does not affect others', async () => {
      // Exhaust tokens for vendor-1
      for (let i = 0; i < 60; i++) {
        await rateLimiter.waitIfNeeded('vendor-1');
      }

      // vendor-2 should still have tokens
      const delay = await rateLimiter.waitIfNeeded('vendor-2');

      expect(delay).toBe(0);
    });

    it('handles many concurrent keys', async () => {
      const keys = Array.from({ length: 100 }, (_, i) => `vendor-${i}`);

      for (const key of keys) {
        const delay = await rateLimiter.waitIfNeeded(key);
        expect(delay).toBe(0);
      }
    });
  });

  describe('Concurrent Requests', () => {
    it('handles concurrent requests to same key', async () => {
      const promises = Array.from({ length: 5 }, () =>
        rateLimiter.waitIfNeeded('vendor-1')
      );

      const delays = await Promise.all(promises);

      // All should succeed without delay (below limit)
      delays.forEach(delay => {
        expect(delay).toBe(0);
      });
    });

    it('correctly consumes tokens for concurrent requests', async () => {
      await Promise.all([
        rateLimiter.waitIfNeeded('vendor-1'),
        rateLimiter.waitIfNeeded('vendor-1'),
        rateLimiter.waitIfNeeded('vendor-1'),
      ]);

      const tokens = rateLimiter.getTokenCount('vendor-1');

      expect(tokens).toBeLessThan(60);
      expect(tokens).toBeGreaterThanOrEqual(57);
    });
  });

  describe('Configuration', () => {
    it('respects custom max tokens', async () => {
      const customLimiter = new MockTokenBucketRateLimiter(10, 60, 60000);

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        await customLimiter.waitIfNeeded('test');
      }

      // Next request should be delayed
      const promise = customLimiter.waitIfNeeded('test');
      jest.advanceTimersByTime(1000);

      const delay = await promise;
      expect(delay).toBeGreaterThan(0);
    });

    it('respects custom refill rate', async () => {
      const slowRefillLimiter = new MockTokenBucketRateLimiter(60, 30, 60000); // 30/min instead of 60/min

      // Consume all tokens
      for (let i = 0; i < 60; i++) {
        await slowRefillLimiter.waitIfNeeded('test');
      }

      // Wait for 30 seconds (should refill 15 tokens at 30/min rate)
      jest.advanceTimersByTime(30000);

      const tokens = slowRefillLimiter.getTokenCount('test');

      expect(tokens).toBeGreaterThanOrEqual(14);
      expect(tokens).toBeLessThanOrEqual(16);
    });

    it('respects custom window size', async () => {
      const shortWindowLimiter = new MockTokenBucketRateLimiter(60, 60, 30000); // 30 second window

      // Consume all tokens
      for (let i = 0; i < 60; i++) {
        await shortWindowLimiter.waitIfNeeded('test');
      }

      // Wait for half window (should refill 30 tokens)
      jest.advanceTimersByTime(15000);

      const tokens = shortWindowLimiter.getTokenCount('test');

      expect(tokens).toBeGreaterThanOrEqual(29);
      expect(tokens).toBeLessThanOrEqual(31);
    });
  });

  describe('Edge Cases', () => {
    it('handles zero tokens gracefully', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 60; i++) {
        await rateLimiter.waitIfNeeded('vendor-1');
      }

      const tokens = rateLimiter.getTokenCount('vendor-1');

      expect(tokens).toBeLessThanOrEqual(1);
      expect(tokens).toBeGreaterThanOrEqual(0);
    });

    it('handles fractional tokens during refill', async () => {
      // Consume some tokens
      for (let i = 0; i < 50; i++) {
        await rateLimiter.waitIfNeeded('vendor-1');
      }

      // Wait for a non-round refill time
      jest.advanceTimersByTime(7500); // 7.5 seconds = 7.5 tokens

      const tokens = rateLimiter.getTokenCount('vendor-1');

      expect(tokens).toBeGreaterThan(10);
      expect(tokens).toBeLessThan(20);
    });

    it('recordOperation() is safe to call', () => {
      expect(() => {
        rateLimiter.recordOperation('vendor-1');
      }).not.toThrow();
    });

    it('handles rapid sequential requests', async () => {
      const delays: number[] = [];

      for (let i = 0; i < 10; i++) {
        const delay = await rateLimiter.waitIfNeeded('vendor-1');
        delays.push(delay);
      }

      // All should be zero (below limit)
      delays.forEach(delay => {
        expect(delay).toBe(0);
      });
    });

    it('reset() clears all buckets', async () => {
      await rateLimiter.waitIfNeeded('vendor-1');
      await rateLimiter.waitIfNeeded('vendor-2');

      rateLimiter.reset();

      const tokens1 = rateLimiter.getTokenCount('vendor-1');
      const tokens2 = rateLimiter.getTokenCount('vendor-2');

      expect(tokens1).toBe(60);
      expect(tokens2).toBe(60);
    });
  });

  describe('Sustained Load', () => {
    it('handles sustained load at rate limit', async () => {
      // Run at exactly the refill rate for multiple windows
      const requestsPerSecond = 1; // 60 per minute = 1 per second
      const duration = 10; // 10 seconds

      for (let i = 0; i < duration; i++) {
        const delay = await rateLimiter.waitIfNeeded('vendor-1');
        expect(delay).toBe(0); // Should never be rate limited if at exact rate

        jest.advanceTimersByTime(1000); // 1 second
      }
    });

    it('enforces limit on burst above rate', async () => {
      // Send burst of requests
      const promises: Promise<number>[] = [];
      for (let i = 0; i < 70; i++) {
        promises.push(rateLimiter.waitIfNeeded('vendor-1'));
      }

      jest.runAllTimers();

      const delays = await Promise.all(promises);

      // First 60 should succeed, rest should be delayed
      const delayedCount = delays.filter(d => d > 0).length;
      expect(delayedCount).toBeGreaterThan(0);
    });
  });
});
