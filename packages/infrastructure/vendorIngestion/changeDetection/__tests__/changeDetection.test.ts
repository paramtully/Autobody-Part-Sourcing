/**
 * Tests for change detection logic.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import type { VendorListingStateRepository } from '../vendorListingStateRepository';
import type { VendorListingState } from '../vendorListingState';

// Mock repository implementation for testing
class MockVendorListingStateRepository implements VendorListingStateRepository {
  private states: Map<string, VendorListingState> = new Map();

  private getKey(vendorId: string, identifier: string): string {
    return `${vendorId}:${identifier}`;
  }

  async findByHash(vendorId: string, payloadHash: string): Promise<VendorListingState | null> {
    for (const state of this.states.values()) {
      if (state.vendorId === vendorId && state.payloadHash === payloadHash) {
        return state;
      }
    }
    return null;
  }

  async findByListingId(
    vendorId: string,
    vendorListingExternalId: string
  ): Promise<VendorListingState | null> {
    const key = this.getKey(vendorId, vendorListingExternalId);
    return this.states.get(key) || null;
  }

  async upsertState(state: Omit<VendorListingState, 'lastSeenAt' | 'lastChangedAt'>): Promise<VendorListingState> {
    const now = new Date();
    const key = this.getKey(state.vendorId, state.vendorListingExternalId || '');
    const existing = this.states.get(key);

    const newState: VendorListingState = {
      ...state,
      lastSeenAt: existing?.lastSeenAt || now,
      lastChangedAt: existing?.lastChangedAt || now,
    };

    this.states.set(key, newState);
    return newState;
  }

  async markSeen(vendorId: string, vendorListingExternalId: string, seenAt: Date): Promise<void> {
    const key = this.getKey(vendorId, vendorListingExternalId);
    const existing = this.states.get(key);
    if (existing) {
      existing.lastSeenAt = seenAt;
      this.states.set(key, existing);
    }
  }

  async findStaleListings(vendorId: string, olderThan: Date): Promise<VendorListingState[]> {
    return Array.from(this.states.values()).filter(
      (state) => state.vendorId === vendorId && state.lastSeenAt < olderThan
    );
  }
}

describe('Change Detection', () => {
  let repository: VendorListingStateRepository;

  beforeEach(() => {
    repository = new MockVendorListingStateRepository();
  });

  describe('Hash Comparison', () => {
    it('identical payload hash → no write (update last_seen_at only)', async () => {
      const vendorId = 'vendor-1';
      const listingId = 'listing-1';
      const hash = 'hash-123';

      // Create initial state
      await repository.upsertState({
        vendorId,
        vendorListingExternalId: listingId,
        payloadHash: hash,
      });

      // Check if hash exists
      const existing = await repository.findByHash(vendorId, hash);
      expect(existing).not.toBeNull();

      // Mark as seen (simulating unchanged payload)
      const seenAt = new Date();
      await repository.markSeen(vendorId, listingId, seenAt);

      const updated = await repository.findByListingId(vendorId, listingId);
      expect(updated?.lastSeenAt).toEqual(seenAt);
      expect(updated?.payloadHash).toBe(hash); // Hash unchanged
    });

    it('different payload hash → write listing update', async () => {
      const vendorId = 'vendor-1';
      const listingId = 'listing-1';
      const oldHash = 'hash-123';
      const newHash = 'hash-456';

      // Create initial state
      await repository.upsertState({
        vendorId,
        vendorListingExternalId: listingId,
        payloadHash: oldHash,
      });

      // Check new hash doesn't exist
      const existing = await repository.findByHash(vendorId, newHash);
      expect(existing).toBeNull();

      // Update with new hash (simulating changed payload)
      const updated = await repository.upsertState({
        vendorId,
        vendorListingExternalId: listingId,
        payloadHash: newHash,
      });

      expect(updated.payloadHash).toBe(newHash);
      expect(updated.lastChangedAt).toBeDefined();
    });
  });

  describe('State Tracking', () => {
    it('findByHash() returns existing state when hash exists', async () => {
      const vendorId = 'vendor-1';
      const hash = 'hash-123';

      await repository.upsertState({
        vendorId,
        vendorListingExternalId: 'listing-1',
        payloadHash: hash,
      });

      const found = await repository.findByHash(vendorId, hash);
      expect(found).not.toBeNull();
      expect(found?.payloadHash).toBe(hash);
    });

    it('findByHash() returns null when hash does not exist', async () => {
      const vendorId = 'vendor-1';
      const hash = 'non-existent-hash';

      const found = await repository.findByHash(vendorId, hash);
      expect(found).toBeNull();
    });

    it('upsertState() creates new state', async () => {
      const state = await repository.upsertState({
        vendorId: 'vendor-1',
        vendorListingExternalId: 'listing-1',
        payloadHash: 'hash-123',
      });

      expect(state).toBeDefined();
      expect(state.vendorId).toBe('vendor-1');
      expect(state.payloadHash).toBe('hash-123');
    });

    it('upsertState() updates existing state', async () => {
      const vendorId = 'vendor-1';
      const listingId = 'listing-1';

      const initial = await repository.upsertState({
        vendorId,
        vendorListingExternalId: listingId,
        payloadHash: 'hash-123',
      });

      const updated = await repository.upsertState({
        vendorId,
        vendorListingExternalId: listingId,
        payloadHash: 'hash-456',
      });

      expect(updated.payloadHash).toBe('hash-456');
      expect(updated.lastChangedAt.getTime()).toBeGreaterThanOrEqual(
        initial.lastChangedAt.getTime()
      );
    });

    it('markSeen() updates last_seen_at without changing hash', async () => {
      const vendorId = 'vendor-1';
      const listingId = 'listing-1';
      const hash = 'hash-123';

      await repository.upsertState({
        vendorId,
        vendorListingExternalId: listingId,
        payloadHash: hash,
      });

      const seenAt = new Date();
      await repository.markSeen(vendorId, listingId, seenAt);

      const state = await repository.findByListingId(vendorId, listingId);
      expect(state?.lastSeenAt).toEqual(seenAt);
      expect(state?.payloadHash).toBe(hash);
    });

    it('findStaleListings() returns listings older than threshold', async () => {
      const vendorId = 'vendor-1';
      const oldDate = new Date('2024-01-01');
      const recentDate = new Date();

      // Create stale listing
      await repository.upsertState({
        vendorId,
        vendorListingExternalId: 'stale-listing',
        payloadHash: 'hash-1',
      });
      await repository.markSeen(vendorId, 'stale-listing', oldDate);

      // Create recent listing
      await repository.upsertState({
        vendorId,
        vendorListingExternalId: 'recent-listing',
        payloadHash: 'hash-2',
      });
      await repository.markSeen(vendorId, 'recent-listing', recentDate);

      const threshold = new Date('2024-06-01');
      const stale = await repository.findStaleListings(vendorId, threshold);

      expect(stale.length).toBeGreaterThan(0);
      expect(stale.some((s) => s.vendorListingExternalId === 'stale-listing')).toBe(true);
    });
  });

  describe('Change Detection Logic', () => {
    it('first ingestion (no existing hash) → write listing', async () => {
      const vendorId = 'vendor-1';
      const hash = 'new-hash';

      const existing = await repository.findByHash(vendorId, hash);
      expect(existing).toBeNull();

      // Simulate first ingestion
      const state = await repository.upsertState({
        vendorId,
        vendorListingExternalId: 'listing-1',
        payloadHash: hash,
      });

      expect(state).toBeDefined();
    });

    it('unchanged payload (hash matches) → no write, update last_seen_at', async () => {
      const vendorId = 'vendor-1';
      const listingId = 'listing-1';
      const hash = 'hash-123';

      await repository.upsertState({
        vendorId,
        vendorListingExternalId: listingId,
        payloadHash: hash,
      });

      const existing = await repository.findByHash(vendorId, hash);
      expect(existing).not.toBeNull();

      // Simulate unchanged payload
      const seenAt = new Date();
      await repository.markSeen(vendorId, listingId, seenAt);

      const updated = await repository.findByListingId(vendorId, listingId);
      expect(updated?.lastSeenAt).toEqual(seenAt);
      expect(updated?.payloadHash).toBe(hash); // Unchanged
    });

    it('changed payload (hash differs) → write listing, update hash', async () => {
      const vendorId = 'vendor-1';
      const listingId = 'listing-1';
      const oldHash = 'hash-123';
      const newHash = 'hash-456';

      await repository.upsertState({
        vendorId,
        vendorListingExternalId: listingId,
        payloadHash: oldHash,
      });

      // Simulate changed payload
      const updated = await repository.upsertState({
        vendorId,
        vendorListingExternalId: listingId,
        payloadHash: newHash,
      });

      expect(updated.payloadHash).toBe(newHash);
      expect(updated.lastChangedAt).toBeDefined();
    });
  });
});
