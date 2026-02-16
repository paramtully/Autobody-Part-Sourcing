/**
 * Unit tests for Raw Payload Retention Cleanup.
 * 
 * Tests cover:
 * - Basic cleanup functionality
 * - Batch processing
 * - Drain-all mode
 * - Timeout enforcement
 * - Monitoring stats
 * - Edge cases
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  cleanupExpiredPayloads,
  type RetentionCleanupStore,
  type RetentionCleanupConfig,
  type RetentionCleanupResult,
} from '../rawPayloadRetention';

/**
 * Mock implementation of RetentionCleanupStore for testing.
 */
class MockRetentionCleanupStore implements RetentionCleanupStore {
  private expiredCount = 0;
  private tableSizeBytes = 1024 * 1024 * 10; // 10MB

  constructor(initialExpiredCount: number = 0) {
    this.expiredCount = initialExpiredCount;
  }

  async deleteExpired(batchSize: number): Promise<number> {
    const toDelete = Math.min(batchSize, this.expiredCount);
    this.expiredCount -= toDelete;

    // Simulate table size reduction (rough estimate: 1KB per row)
    this.tableSizeBytes -= toDelete * 1024;

    return toDelete;
  }

  async countExpired(): Promise<number> {
    return this.expiredCount;
  }

  async getTableSizeBytes(): Promise<number> {
    return this.tableSizeBytes;
  }

  // Test helpers
  setExpiredCount(count: number): void {
    this.expiredCount = count;
  }

  setTableSizeBytes(bytes: number): void {
    this.tableSizeBytes = bytes;
  }
}

describe('cleanupExpiredPayloads', () => {
  let store: MockRetentionCleanupStore;

  beforeEach(() => {
    store = new MockRetentionCleanupStore();
  });

  describe('Basic Cleanup', () => {
    it('deletes expired payloads', async () => {
      store.setExpiredCount(100);

      const result = await cleanupExpiredPayloads(store);

      expect(result.totalDeleted).toBe(100);
      expect(result.batchesExecuted).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('returns zero when no expired payloads', async () => {
      store.setExpiredCount(0);

      const result = await cleanupExpiredPayloads(store);

      expect(result.totalDeleted).toBe(0);
      expect(result.batchesExecuted).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('returns duration in milliseconds', async () => {
      store.setExpiredCount(100);

      const result = await cleanupExpiredPayloads(store);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeLessThan(1000); // Should be fast for mock
    });

    it('returns table size after cleanup', async () => {
      store.setExpiredCount(100);
      store.setTableSizeBytes(10 * 1024 * 1024); // 10MB

      const result = await cleanupExpiredPayloads(store);

      expect(result.tableSizeBytesAfter).toBeDefined();
      expect(result.tableSizeBytesAfter).toBeLessThan(10 * 1024 * 1024);
    });
  });

  describe('Batch Processing', () => {
    it('respects batch size limit', async () => {
      store.setExpiredCount(25000);

      const result = await cleanupExpiredPayloads(store, { batchSize: 10000 });

      expect(result.totalDeleted).toBe(10000);
      expect(result.batchesExecuted).toBe(1);
      expect(result.hasMore).toBe(true);
    });

    it('sets hasMore when more rows exist', async () => {
      store.setExpiredCount(15000);

      const result = await cleanupExpiredPayloads(store, { batchSize: 10000 });

      expect(result.hasMore).toBe(true);
      expect(await store.countExpired()).toBe(5000);
    });

    it('sets hasMore to false when all deleted', async () => {
      store.setExpiredCount(5000);

      const result = await cleanupExpiredPayloads(store, { batchSize: 10000 });

      expect(result.hasMore).toBe(false);
      expect(await store.countExpired()).toBe(0);
    });

    it('handles partial batch on last iteration', async () => {
      store.setExpiredCount(15000);

      const result = await cleanupExpiredPayloads(store, {
        batchSize: 10000,
        drainAll: true,
      });

      expect(result.totalDeleted).toBe(15000);
      expect(result.batchesExecuted).toBe(2);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('Drain-All Mode', () => {
    it('processes multiple batches when drainAll is true', async () => {
      store.setExpiredCount(35000);

      const result = await cleanupExpiredPayloads(store, {
        batchSize: 10000,
        drainAll: true,
      });

      expect(result.totalDeleted).toBe(35000);
      expect(result.batchesExecuted).toBe(4); // 10k, 10k, 10k, 5k
      expect(result.hasMore).toBe(false);
    });

    it('stops after one batch when drainAll is false', async () => {
      store.setExpiredCount(35000);

      const result = await cleanupExpiredPayloads(store, {
        batchSize: 10000,
        drainAll: false,
      });

      expect(result.totalDeleted).toBe(10000);
      expect(result.batchesExecuted).toBe(1);
      expect(result.hasMore).toBe(true);
    });

    it('uses default drainAll=false when not specified', async () => {
      store.setExpiredCount(35000);

      const result = await cleanupExpiredPayloads(store, { batchSize: 10000 });

      expect(result.totalDeleted).toBe(10000);
      expect(result.batchesExecuted).toBe(1);
    });
  });

  describe('Timeout Enforcement', () => {
    it('stops processing when maxDurationMs exceeded', async () => {
      const slowStore: RetentionCleanupStore = {
        deleteExpired: jest.fn().mockImplementation(async (batchSize: number) => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return batchSize;
        }),
        countExpired: jest.fn().mockResolvedValue(1000000),
        getTableSizeBytes: jest.fn().mockResolvedValue(1024 * 1024),
      };

      const result = await cleanupExpiredPayloads(slowStore, {
        batchSize: 10000,
        drainAll: true,
        maxDurationMs: 250, // Only allow ~2 batches
      });

      expect(result.batchesExecuted).toBeLessThan(10);
      expect(result.durationMs).toBeGreaterThanOrEqual(200);
      expect(result.durationMs).toBeLessThan(400);
    });

    it('respects default maxDurationMs of 30 seconds', async () => {
      store.setExpiredCount(100);

      const startTime = Date.now();
      await cleanupExpiredPayloads(store);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(30000);
    });

    it('allows custom maxDurationMs', async () => {
      store.setExpiredCount(100);

      const result = await cleanupExpiredPayloads(store, {
        maxDurationMs: 5000,
      });

      expect(result.durationMs).toBeLessThan(5000);
    });
  });

  describe('Configuration', () => {
    it('uses default config when none provided', async () => {
      store.setExpiredCount(5000);

      const result = await cleanupExpiredPayloads(store);

      expect(result.totalDeleted).toBe(5000);
      expect(result.batchesExecuted).toBe(1);
    });

    it('merges partial config with defaults', async () => {
      store.setExpiredCount(5000);

      const result = await cleanupExpiredPayloads(store, {
        batchSize: 2000, // Custom
        // drainAll and maxDurationMs use defaults
      });

      expect(result.totalDeleted).toBe(2000); // Custom batch size
      expect(result.batchesExecuted).toBe(1); // Default drainAll=false
    });

    it('accepts all custom config values', async () => {
      store.setExpiredCount(30000);

      const result = await cleanupExpiredPayloads(store, {
        batchSize: 5000,
        drainAll: true,
        maxDurationMs: 10000,
      });

      expect(result.totalDeleted).toBe(30000);
      expect(result.batchesExecuted).toBe(6);
    });
  });

  describe('Monitoring Stats', () => {
    it('tracks total deleted across batches', async () => {
      store.setExpiredCount(25000);

      const result = await cleanupExpiredPayloads(store, {
        batchSize: 10000,
        drainAll: true,
      });

      expect(result.totalDeleted).toBe(25000);
    });

    it('tracks batches executed', async () => {
      store.setExpiredCount(25000);

      const result = await cleanupExpiredPayloads(store, {
        batchSize: 10000,
        drainAll: true,
      });

      expect(result.batchesExecuted).toBe(3);
    });

    it('includes table size for monitoring', async () => {
      store.setExpiredCount(10000);
      store.setTableSizeBytes(100 * 1024 * 1024); // 100MB

      const result = await cleanupExpiredPayloads(store);

      expect(result.tableSizeBytesAfter).toBeDefined();
      expect(result.tableSizeBytesAfter).toBeGreaterThan(0);
    });

    it('handles table size query failure gracefully', async () => {
      const failingStore: RetentionCleanupStore = {
        deleteExpired: jest.fn().mockResolvedValue(100),
        countExpired: jest.fn().mockResolvedValue(100),
        getTableSizeBytes: jest.fn().mockRejectedValue(new Error('Permission denied')),
      };

      const result = await cleanupExpiredPayloads(failingStore);

      expect(result.tableSizeBytesAfter).toBeUndefined();
      expect(result.totalDeleted).toBe(100); // Cleanup still succeeded
    });

    it('provides accurate duration measurement', async () => {
      const delayStore: RetentionCleanupStore = {
        deleteExpired: jest.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 100;
        }),
        countExpired: jest.fn().mockResolvedValue(100),
        getTableSizeBytes: jest.fn().mockResolvedValue(1024),
      };

      const result = await cleanupExpiredPayloads(delayStore);

      expect(result.durationMs).toBeGreaterThanOrEqual(50);
      expect(result.durationMs).toBeLessThan(200);
    });
  });

  describe('Edge Cases', () => {
    it('handles zero batch size gracefully', async () => {
      store.setExpiredCount(100);

      const result = await cleanupExpiredPayloads(store, { batchSize: 0 });

      expect(result.totalDeleted).toBe(0);
      expect(result.batchesExecuted).toBe(1);
    });

    it('handles very large expired count', async () => {
      store.setExpiredCount(1000000);

      const result = await cleanupExpiredPayloads(store, {
        batchSize: 10000,
        drainAll: false,
      });

      expect(result.totalDeleted).toBe(10000);
      expect(result.hasMore).toBe(true);
    });

    it('handles store delete returning zero', async () => {
      const emptyStore: RetentionCleanupStore = {
        deleteExpired: jest.fn().mockResolvedValue(0),
        countExpired: jest.fn().mockResolvedValue(0),
        getTableSizeBytes: jest.fn().mockResolvedValue(1024),
      };

      const result = await cleanupExpiredPayloads(emptyStore);

      expect(result.totalDeleted).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('handles negative batch size as zero', async () => {
      store.setExpiredCount(100);

      const result = await cleanupExpiredPayloads(store, { batchSize: -1000 });

      expect(result.totalDeleted).toBe(0);
    });

    it('handles very short maxDurationMs', async () => {
      store.setExpiredCount(100);

      const result = await cleanupExpiredPayloads(store, {
        maxDurationMs: 1, // 1ms timeout
      });

      // Should execute at least one batch before checking timeout
      expect(result.batchesExecuted).toBeGreaterThanOrEqual(1);
    });

    it('handles exactly batch-size number of expired rows', async () => {
      store.setExpiredCount(10000);

      const result = await cleanupExpiredPayloads(store, { batchSize: 10000 });

      expect(result.totalDeleted).toBe(10000);
      expect(result.hasMore).toBe(true); // Optimistic: might be more
    });

    it('continues on next invocation after hasMore=true', async () => {
      store.setExpiredCount(25000);

      // First invocation
      const result1 = await cleanupExpiredPayloads(store, { batchSize: 10000 });
      expect(result1.totalDeleted).toBe(10000);
      expect(result1.hasMore).toBe(true);

      // Second invocation
      const result2 = await cleanupExpiredPayloads(store, { batchSize: 10000 });
      expect(result2.totalDeleted).toBe(10000);
      expect(result2.hasMore).toBe(true);

      // Third invocation
      const result3 = await cleanupExpiredPayloads(store, { batchSize: 10000 });
      expect(result3.totalDeleted).toBe(5000);
      expect(result3.hasMore).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('propagates store deleteExpired errors', async () => {
      const failingStore: RetentionCleanupStore = {
        deleteExpired: jest.fn().mockRejectedValue(new Error('Database error')),
        countExpired: jest.fn().mockResolvedValue(100),
        getTableSizeBytes: jest.fn().mockResolvedValue(1024),
      };

      await expect(cleanupExpiredPayloads(failingStore)).rejects.toThrow('Database error');
    });

    it('stops processing on error', async () => {
      let callCount = 0;
      const partialFailStore: RetentionCleanupStore = {
        deleteExpired: jest.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 2) {
            throw new Error('Batch 2 failed');
          }
          return 10000;
        }),
        countExpired: jest.fn().mockResolvedValue(100000),
        getTableSizeBytes: jest.fn().mockResolvedValue(1024),
      };

      await expect(
        cleanupExpiredPayloads(partialFailStore, {
          batchSize: 10000,
          drainAll: true,
        })
      ).rejects.toThrow('Batch 2 failed');

      expect(callCount).toBe(2);
    });
  });

  describe('Performance Characteristics', () => {
    it('handles large batch cleanup efficiently', async () => {
      store.setExpiredCount(100000);

      const startTime = Date.now();
      await cleanupExpiredPayloads(store, {
        batchSize: 100000,
        drainAll: false,
      });
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100); // Should be very fast for mock
    });

    it('drainAll mode processes all batches', async () => {
      store.setExpiredCount(100000);

      const result = await cleanupExpiredPayloads(store, {
        batchSize: 10000,
        drainAll: true,
      });

      expect(result.totalDeleted).toBe(100000);
      expect(result.batchesExecuted).toBe(10);
      expect(result.hasMore).toBe(false);
    });

    it('limits execution time even with many batches', async () => {
      store.setExpiredCount(1000000);

      const result = await cleanupExpiredPayloads(store, {
        batchSize: 10000,
        drainAll: true,
        maxDurationMs: 100,
      });

      expect(result.durationMs).toBeLessThanOrEqual(150); // Some overhead allowed
      expect(result.hasMore).toBe(true); // Stopped due to timeout
    });
  });
});
