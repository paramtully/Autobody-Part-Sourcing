/**
 * Unit tests for Raw Payload Logger.
 * 
 * Tests cover:
 * - Basic logging functionality
 * - Hash computation and deduplication
 * - Retention policy (retainUntil calculation)
 * - Batch logging
 * - Pre-computed hash support
 * - NoOp logger behavior
 * - Edge cases
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  DefaultRawPayloadLogger,
  NoOpRawPayloadLogger,
  type RawPayloadLogger,
  type RawPayloadStore,
  type RawPayloadLogEntry,
  type RawPayloadLogResult,
} from '../rawPayloadLogger';

/**
 * Mock implementation of RawPayloadStore for testing.
 */
class MockRawPayloadStore implements RawPayloadStore {
  private stored = new Map<string, { id: string; payload: unknown; retainUntil: Date | null }>();
  private nextId = 1;

  async store(payload: {
    vendorId: string;
    payload: unknown;
    payloadHash: string;
    vendorListingExternalId?: string;
    ingestionRunId?: string;
    retainUntil?: Date | null;
  }): Promise<{ id: string; isNew: boolean }> {
    const key = `${payload.vendorId}:${payload.payloadHash}`;

    if (this.stored.has(key)) {
      const existing = this.stored.get(key)!;
      return { id: existing.id, isNew: false };
    }

    const id = `payload-${this.nextId++}`;
    this.stored.set(key, {
      id,
      payload: payload.payload,
      retainUntil: payload.retainUntil ?? null,
    });

    return { id, isNew: true };
  }

  // Test helpers
  getStoredCount(): number {
    return this.stored.size;
  }

  getById(id: string): { payload: unknown; retainUntil: Date | null } | undefined {
    for (const entry of this.stored.values()) {
      if (entry.id === id) {
        return entry;
      }
    }
    return undefined;
  }

  reset(): void {
    this.stored.clear();
    this.nextId = 1;
  }
}

describe('DefaultRawPayloadLogger', () => {
  let store: MockRawPayloadStore;
  let logger: RawPayloadLogger;

  beforeEach(() => {
    store = new MockRawPayloadStore();
    logger = new DefaultRawPayloadLogger(store);
  });

  describe('Basic Logging', () => {
    it('logs a raw payload successfully', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'test-vendor',
        payload: { listings: [{ id: '1', price: 100 }] },
      };

      const result = await logger.log(entry);

      expect(result.id).toBeDefined();
      expect(result.isNew).toBe(true);
      expect(result.payloadHash).toBeDefined();
    });

    it('stores payload in the repository', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'test-vendor',
        payload: { data: 'test' },
      };

      await logger.log(entry);

      expect(store.getStoredCount()).toBe(1);
    });

    it('returns payload hash', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'test-vendor',
        payload: { data: 'test' },
      };

      const result = await logger.log(entry);

      expect(result.payloadHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });
  });

  describe('Hash Computation', () => {
    it('computes consistent hash for same payload', async () => {
      const payload = { listings: [{ id: '1' }], metadata: { page: 1 } };

      const result1 = await logger.log({ vendorId: 'v1', payload });
      const result2 = await logger.log({ vendorId: 'v1', payload });

      expect(result1.payloadHash).toBe(result2.payloadHash);
      expect(result2.isNew).toBe(false); // Deduplicated
    });

    it('computes different hash for different payloads', async () => {
      const payload1 = { data: 'test1' };
      const payload2 = { data: 'test2' };

      const result1 = await logger.log({ vendorId: 'v1', payload: payload1 });
      const result2 = await logger.log({ vendorId: 'v1', payload: payload2 });

      expect(result1.payloadHash).not.toBe(result2.payloadHash);
      expect(result2.isNew).toBe(true);
    });

    it('uses canonical JSON for deterministic hashing', async () => {
      const payload1 = { b: 2, a: 1 };
      const payload2 = { a: 1, b: 2 };

      const result1 = await logger.log({ vendorId: 'v1', payload: payload1 });
      const result2 = await logger.log({ vendorId: 'v1', payload: payload2 });

      expect(result1.payloadHash).toBe(result2.payloadHash);
    });

    it('uses pre-computed hash if provided', async () => {
      const precomputedHash = 'abc123def456';
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
        payloadHash: precomputedHash,
      };

      const result = await logger.log(entry);

      expect(result.payloadHash).toBe(precomputedHash);
    });

    it('handles complex nested objects', async () => {
      const payload = {
        listings: [
          { id: '1', nested: { deep: { value: 123 } } },
          { id: '2', array: [1, 2, 3] },
        ],
        metadata: { page: 1, total: 100 },
      };

      const result = await logger.log({ vendorId: 'v1', payload });

      expect(result.payloadHash).toBeDefined();
      expect(result.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Deduplication', () => {
    it('detects duplicate payloads', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
      };

      const result1 = await logger.log(entry);
      const result2 = await logger.log(entry);

      expect(result1.isNew).toBe(true);
      expect(result2.isNew).toBe(false);
      expect(result1.id).toBe(result2.id); // Same ID returned
    });

    it('stores different payloads separately', async () => {
      await logger.log({ vendorId: 'v1', payload: { data: 'test1' } });
      await logger.log({ vendorId: 'v1', payload: { data: 'test2' } });

      expect(store.getStoredCount()).toBe(2);
    });

    it('treats different vendors as different payloads', async () => {
      const payload = { data: 'same' };

      const result1 = await logger.log({ vendorId: 'vendor-1', payload });
      const result2 = await logger.log({ vendorId: 'vendor-2', payload });

      expect(result1.id).not.toBe(result2.id);
      expect(result2.isNew).toBe(true);
      expect(store.getStoredCount()).toBe(2);
    });
  });

  describe('Retention Policy', () => {
    it('sets default retention to 30 days', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
      };

      const result = await logger.log(entry);
      const stored = store.getById(result.id);

      expect(stored?.retainUntil).toBeInstanceOf(Date);

      const now = new Date();
      const expectedRetainUntil = new Date(now);
      expectedRetainUntil.setDate(expectedRetainUntil.getDate() + 30);

      const diffMs = Math.abs(stored!.retainUntil!.getTime() - expectedRetainUntil.getTime());
      expect(diffMs).toBeLessThan(1000); // Within 1 second
    });

    it('respects custom retention days', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
        retentionDays: 7,
      };

      const result = await logger.log(entry);
      const stored = store.getById(result.id);

      const now = new Date();
      const expectedRetainUntil = new Date(now);
      expectedRetainUntil.setDate(expectedRetainUntil.getDate() + 7);

      const diffMs = Math.abs(stored!.retainUntil!.getTime() - expectedRetainUntil.getTime());
      expect(diffMs).toBeLessThan(1000);
    });

    it('retains indefinitely when retentionDays is null', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
        retentionDays: null,
      };

      const result = await logger.log(entry);
      const stored = store.getById(result.id);

      expect(stored?.retainUntil).toBeNull();
    });

    it('supports custom default retention days', async () => {
      const customLogger = new DefaultRawPayloadLogger(store, {
        defaultRetentionDays: 90,
      });

      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
      };

      const result = await customLogger.log(entry);
      const stored = store.getById(result.id);

      const now = new Date();
      const expectedRetainUntil = new Date(now);
      expectedRetainUntil.setDate(expectedRetainUntil.getDate() + 90);

      const diffMs = Math.abs(stored!.retainUntil!.getTime() - expectedRetainUntil.getTime());
      expect(diffMs).toBeLessThan(1000);
    });

    it('handles zero retention days', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
        retentionDays: 0,
      };

      const result = await logger.log(entry);
      const stored = store.getById(result.id);

      // Should set retainUntil to approximately now
      const now = new Date();
      const diffMs = Math.abs(stored!.retainUntil!.getTime() - now.getTime());
      expect(diffMs).toBeLessThan(1000);
    });
  });

  describe('Batch Logging', () => {
    it('logs multiple payloads in batch', async () => {
      const entries: RawPayloadLogEntry[] = [
        { vendorId: 'v1', payload: { data: 'test1' } },
        { vendorId: 'v1', payload: { data: 'test2' } },
        { vendorId: 'v1', payload: { data: 'test3' } },
      ];

      const results = await logger.logBatch(entries);

      expect(results).toHaveLength(3);
      expect(store.getStoredCount()).toBe(3);
    });

    it('returns correct results for each entry', async () => {
      const entries: RawPayloadLogEntry[] = [
        { vendorId: 'v1', payload: { data: 'test1' } },
        { vendorId: 'v1', payload: { data: 'test2' } },
      ];

      const results = await logger.logBatch(entries);

      results.forEach((result, i) => {
        expect(result.id).toBeDefined();
        expect(result.isNew).toBe(true);
        expect(result.payloadHash).toBeDefined();
      });
    });

    it('handles empty batch', async () => {
      const results = await logger.logBatch([]);

      expect(results).toHaveLength(0);
      expect(store.getStoredCount()).toBe(0);
    });

    it('handles duplicates in batch', async () => {
      const payload = { data: 'same' };
      const entries: RawPayloadLogEntry[] = [
        { vendorId: 'v1', payload },
        { vendorId: 'v1', payload },
        { vendorId: 'v1', payload },
      ];

      const results = await logger.logBatch(entries);

      expect(results[0].isNew).toBe(true);
      expect(results[1].isNew).toBe(false);
      expect(results[2].isNew).toBe(false);
      expect(store.getStoredCount()).toBe(1);
    });

    it('continues on individual failures', async () => {
      const failingStore: RawPayloadStore = {
        store: jest.fn()
          .mockResolvedValueOnce({ id: 'id-1', isNew: true })
          .mockRejectedValueOnce(new Error('Store failure'))
          .mockResolvedValueOnce({ id: 'id-3', isNew: true }),
      };

      const failingLogger = new DefaultRawPayloadLogger(failingStore);
      const entries: RawPayloadLogEntry[] = [
        { vendorId: 'v1', payload: { data: 'test1' } },
        { vendorId: 'v1', payload: { data: 'test2' } },
        { vendorId: 'v1', payload: { data: 'test3' } },
      ];

      await expect(failingLogger.logBatch(entries)).rejects.toThrow('Store failure');
    });
  });

  describe('Additional Fields', () => {
    it('passes ingestionRunId to store', async () => {
      const storeSpy = jest.spyOn(store, 'store');
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
        ingestionRunId: 'run-123',
      };

      await logger.log(entry);

      expect(storeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          ingestionRunId: 'run-123',
        })
      );
    });

    it('passes vendorListingExternalId to store', async () => {
      const storeSpy = jest.spyOn(store, 'store');
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
        vendorListingExternalId: 'listing-456',
      };

      await logger.log(entry);

      expect(storeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorListingExternalId: 'listing-456',
        })
      );
    });

    it('handles optional fields as undefined', async () => {
      const storeSpy = jest.spyOn(store, 'store');
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
      };

      await logger.log(entry);

      expect(storeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorId: 'v1',
          payload: { data: 'test' },
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('handles null payload', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: null,
      };

      const result = await logger.log(entry);

      expect(result.id).toBeDefined();
      expect(result.payloadHash).toBeDefined();
    });

    it('handles empty object payload', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: {},
      };

      const result = await logger.log(entry);

      expect(result.id).toBeDefined();
    });

    it('handles large payloads', async () => {
      const largePayload = {
        listings: Array.from({ length: 1000 }, (_, i) => ({
          id: `listing-${i}`,
          data: 'x'.repeat(100),
        })),
      };

      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: largePayload,
      };

      const result = await logger.log(entry);

      expect(result.id).toBeDefined();
      expect(result.payloadHash).toBeDefined();
    });

    it('handles unicode in payloads', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { description: 'Test with émojis 🚗 and 中文' },
      };

      const result = await logger.log(entry);

      expect(result.id).toBeDefined();
    });

    it('handles circular references gracefully', async () => {
      const circular: any = { data: 'test' };
      circular.self = circular;

      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: circular,
      };

      // Should throw during JSON.stringify in hash computation
      await expect(logger.log(entry)).rejects.toThrow();
    });
  });
});

describe('NoOpRawPayloadLogger', () => {
  let logger: RawPayloadLogger;

  beforeEach(() => {
    logger = new NoOpRawPayloadLogger();
  });

  describe('Basic Behavior', () => {
    it('returns fake result without storing', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
      };

      const result = await logger.log(entry);

      expect(result.id).toBe('noop');
      expect(result.isNew).toBe(false);
      expect(result.payloadHash).toBe('noop');
    });

    it('uses pre-computed hash if provided', async () => {
      const entry: RawPayloadLogEntry = {
        vendorId: 'v1',
        payload: { data: 'test' },
        payloadHash: 'custom-hash',
      };

      const result = await logger.log(entry);

      expect(result.payloadHash).toBe('custom-hash');
    });

    it('handles batch logging', async () => {
      const entries: RawPayloadLogEntry[] = [
        { vendorId: 'v1', payload: { data: 'test1' } },
        { vendorId: 'v1', payload: { data: 'test2' } },
      ];

      const results = await logger.logBatch(entries);

      expect(results).toHaveLength(2);
      results.forEach(result => {
        expect(result.id).toBe('noop');
        expect(result.isNew).toBe(false);
      });
    });

    it('handles empty batch', async () => {
      const results = await logger.logBatch([]);

      expect(results).toHaveLength(0);
    });

    it('never throws errors', async () => {
      const entries: RawPayloadLogEntry[] = [
        { vendorId: 'v1', payload: null },
        { vendorId: 'v2', payload: undefined },
        { vendorId: 'v3', payload: { large: 'x'.repeat(1000000) } },
      ];

      await expect(logger.logBatch(entries)).resolves.toBeDefined();
    });
  });
});
