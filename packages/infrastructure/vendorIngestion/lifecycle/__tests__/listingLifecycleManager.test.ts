/**
 * Unit tests for Listing Lifecycle Management.
 * 
 * Tests cover:
 * - State machine transitions
 * - Lifecycle manager operations
 * - Stale listing detection
 * - Reactivation logic
 * - Configuration per-vendor
 * - Edge cases
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  transitionListingState,
  type ListingLifecycleState,
  type ListingLifecycleEvent,
  type StateTransitionResult,
} from '../listingStateMachine';
import {
  DefaultListingLifecycleManager,
  type ListingLifecycleManager,
  type LifecycleRepository,
  type ListingLifecycleRecord,
  type StaleDetectionResult,
} from '../listingLifecycleManager';
import type { LifecycleConfig } from '../lifecycleConfig';

describe('ListingStateMachine', () => {
  describe('ACTIVE state', () => {
    it('remains ACTIVE when seen again', () => {
      const result = transitionListingState(
        'ACTIVE',
        { type: 'SEEN', seenAt: '2026-02-13T12:00:00Z' }
      );

      expect(result.newState).toBe('ACTIVE');
      expect(result.changed).toBe(false);
      expect(result.timestamps.lastSeenAt).toBe('2026-02-13T12:00:00Z');
    });

    it('remains ACTIVE when missed below threshold', () => {
      const result = transitionListingState(
        'ACTIVE',
        { type: 'MISSED', missCount: 2, missThreshold: 5 }
      );

      expect(result.newState).toBe('ACTIVE');
      expect(result.changed).toBe(false);
    });

    it('transitions to PRESUMED_INACTIVE when missed at threshold', () => {
      const result = transitionListingState(
        'ACTIVE',
        { type: 'MISSED', missCount: 5, missThreshold: 5 }
      );

      expect(result.newState).toBe('PRESUMED_INACTIVE');
      expect(result.changed).toBe(true);
      expect(result.reason).toContain('Missed 5 consecutive polls');
      expect(result.timestamps.markedInactiveAt).toBeDefined();
    });

    it('transitions to PRESUMED_INACTIVE when missed above threshold', () => {
      const result = transitionListingState(
        'ACTIVE',
        { type: 'MISSED', missCount: 10, missThreshold: 5 }
      );

      expect(result.newState).toBe('PRESUMED_INACTIVE');
      expect(result.changed).toBe(true);
    });

    it('transitions to VENDOR_INACTIVE when vendor deactivates', () => {
      const result = transitionListingState(
        'ACTIVE',
        { type: 'VENDOR_DEACTIVATED', reason: 'Out of stock' }
      );

      expect(result.newState).toBe('VENDOR_INACTIVE');
      expect(result.changed).toBe(true);
      expect(result.reason).toContain('Out of stock');
      expect(result.timestamps.markedInactiveAt).toBeDefined();
    });
  });

  describe('PRESUMED_INACTIVE state', () => {
    it('transitions back to ACTIVE when seen again', () => {
      const result = transitionListingState(
        'PRESUMED_INACTIVE',
        { type: 'SEEN', seenAt: '2026-02-13T12:00:00Z' }
      );

      expect(result.newState).toBe('ACTIVE');
      expect(result.changed).toBe(true);
      expect(result.reason).toContain('reappeared');
      expect(result.timestamps.lastSeenAt).toBe('2026-02-13T12:00:00Z');
      expect(result.timestamps.reactivatedAt).toBe('2026-02-13T12:00:00Z');
    });

    it('stays PRESUMED_INACTIVE when reactivation disabled', () => {
      const result = transitionListingState(
        'PRESUMED_INACTIVE',
        { type: 'SEEN', seenAt: '2026-02-13T12:00:00Z' },
        false // allowReactivation = false
      );

      expect(result.newState).toBe('PRESUMED_INACTIVE');
      expect(result.changed).toBe(false);
      expect(result.reason).toContain('reactivation is disabled');
    });

    it('stays PRESUMED_INACTIVE when missed', () => {
      const result = transitionListingState(
        'PRESUMED_INACTIVE',
        { type: 'MISSED', missCount: 10, missThreshold: 5 }
      );

      expect(result.newState).toBe('PRESUMED_INACTIVE');
      expect(result.changed).toBe(false);
    });

    it('transitions to VENDOR_INACTIVE when vendor deactivates', () => {
      const result = transitionListingState(
        'PRESUMED_INACTIVE',
        { type: 'VENDOR_DEACTIVATED', reason: 'Discontinued' }
      );

      expect(result.newState).toBe('VENDOR_INACTIVE');
      expect(result.changed).toBe(true);
    });
  });

  describe('VENDOR_INACTIVE state', () => {
    it('transitions back to ACTIVE when reactivated', () => {
      const result = transitionListingState(
        'VENDOR_INACTIVE',
        { type: 'VENDOR_REACTIVATED', seenAt: '2026-02-13T12:00:00Z' }
      );

      expect(result.newState).toBe('ACTIVE');
      expect(result.changed).toBe(true);
      expect(result.timestamps.reactivatedAt).toBe('2026-02-13T12:00:00Z');
    });

    it('stays VENDOR_INACTIVE when reactivation disabled', () => {
      const result = transitionListingState(
        'VENDOR_INACTIVE',
        { type: 'VENDOR_REACTIVATED', seenAt: '2026-02-13T12:00:00Z' },
        false
      );

      expect(result.newState).toBe('VENDOR_INACTIVE');
      expect(result.changed).toBe(false);
    });

    it('stays VENDOR_INACTIVE when missed', () => {
      const result = transitionListingState(
        'VENDOR_INACTIVE',
        { type: 'MISSED', missCount: 10, missThreshold: 5 }
      );

      expect(result.newState).toBe('VENDOR_INACTIVE');
      expect(result.changed).toBe(false);
    });

    it('stays VENDOR_INACTIVE when deactivated again', () => {
      const result = transitionListingState(
        'VENDOR_INACTIVE',
        { type: 'VENDOR_DEACTIVATED', reason: 'Still inactive' }
      );

      expect(result.newState).toBe('VENDOR_INACTIVE');
      expect(result.changed).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('handles zero miss threshold', () => {
      const result = transitionListingState(
        'ACTIVE',
        { type: 'MISSED', missCount: 0, missThreshold: 0 }
      );

      expect(result.newState).toBe('PRESUMED_INACTIVE');
      expect(result.changed).toBe(true);
    });

    it('handles large miss counts', () => {
      const result = transitionListingState(
        'ACTIVE',
        { type: 'MISSED', missCount: 1000, missThreshold: 5 }
      );

      expect(result.newState).toBe('PRESUMED_INACTIVE');
      expect(result.changed).toBe(true);
    });

    it('handles empty reason for vendor deactivation', () => {
      const result = transitionListingState(
        'ACTIVE',
        { type: 'VENDOR_DEACTIVATED', reason: '' }
      );

      expect(result.newState).toBe('VENDOR_INACTIVE');
      expect(result.changed).toBe(true);
    });
  });
});

/**
 * Mock repository for testing lifecycle manager.
 */
class MockLifecycleRepository implements LifecycleRepository {
  private records = new Map<string, ListingLifecycleRecord>();

  async getLifecycleState(
    vendorId: string,
    vendorListingExternalId: string
  ): Promise<ListingLifecycleRecord | null> {
    const key = `${vendorId}:${vendorListingExternalId}`;
    return this.records.get(key) ?? null;
  }

  async upsertLifecycleState(record: ListingLifecycleRecord): Promise<void> {
    const key = `${record.vendorId}:${record.vendorListingExternalId}`;
    this.records.set(key, record);
  }

  async findStaleActiveListings(
    vendorId: string,
    notSeenSince: Date
  ): Promise<ListingLifecycleRecord[]> {
    const stale: ListingLifecycleRecord[] = [];
    for (const record of this.records.values()) {
      if (
        record.vendorId === vendorId &&
        record.state === 'ACTIVE' &&
        new Date(record.lastSeenAt) < notSeenSince
      ) {
        stale.push(record);
      }
    }
    return stale;
  }

  async findMissedListings(
    vendorId: string,
    minMissCount: number
  ): Promise<ListingLifecycleRecord[]> {
    const missed: ListingLifecycleRecord[] = [];
    for (const record of this.records.values()) {
      if (
        record.vendorId === vendorId &&
        record.state === 'ACTIVE' &&
        record.consecutiveMissCount >= minMissCount
      ) {
        missed.push(record);
      }
    }
    return missed;
  }

  async batchUpdateLifecycleStates(records: ListingLifecycleRecord[]): Promise<void> {
    for (const record of records) {
      await this.upsertLifecycleState(record);
    }
  }

  // Test helpers
  addRecord(record: ListingLifecycleRecord): void {
    const key = `${record.vendorId}:${record.vendorListingExternalId}`;
    this.records.set(key, record);
  }

  reset(): void {
    this.records.clear();
  }

  getAllRecords(): ListingLifecycleRecord[] {
    return Array.from(this.records.values());
  }
}

describe('DefaultListingLifecycleManager', () => {
  let repository: MockLifecycleRepository;
  let manager: ListingLifecycleManager;

  const defaultConfig: LifecycleConfig = {
    consecutiveMissThreshold: 5,
    staleDaysThreshold: 30,
    allowReactivation: true,
  };

  beforeEach(() => {
    repository = new MockLifecycleRepository();
    manager = new DefaultListingLifecycleManager(repository);
  });

  describe('recordSeen()', () => {
    it('creates new record for first-time listing', async () => {
      const result = await manager.recordSeen(
        'test-vendor',
        'listing-123',
        '2026-02-13T12:00:00Z',
        defaultConfig
      );

      expect(result.newState).toBe('ACTIVE');
      expect(result.changed).toBe(true);

      const record = await repository.getLifecycleState('test-vendor', 'listing-123');
      expect(record).toBeDefined();
      expect(record!.state).toBe('ACTIVE');
      expect(record!.consecutiveMissCount).toBe(0);
    });

    it('updates existing ACTIVE listing', async () => {
      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-123',
        state: 'ACTIVE',
        consecutiveMissCount: 0,
        lastSeenAt: '2026-02-01T12:00:00Z',
      });

      const result = await manager.recordSeen(
        'test-vendor',
        'listing-123',
        '2026-02-13T12:00:00Z',
        defaultConfig
      );

      expect(result.newState).toBe('ACTIVE');
      expect(result.changed).toBe(false);
      expect(result.timestamps.lastSeenAt).toBe('2026-02-13T12:00:00Z');
    });

    it('reactivates PRESUMED_INACTIVE listing', async () => {
      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-123',
        state: 'PRESUMED_INACTIVE',
        consecutiveMissCount: 10,
        lastSeenAt: '2026-01-01T12:00:00Z',
        markedInactiveAt: '2026-01-15T12:00:00Z',
      });

      const result = await manager.recordSeen(
        'test-vendor',
        'listing-123',
        '2026-02-13T12:00:00Z',
        defaultConfig
      );

      expect(result.newState).toBe('ACTIVE');
      expect(result.changed).toBe(true);
      expect(result.reason).toContain('reappeared');

      const record = await repository.getLifecycleState('test-vendor', 'listing-123');
      expect(record!.consecutiveMissCount).toBe(0); // Reset miss count
    });

    it('respects allowReactivation config', async () => {
      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-123',
        state: 'PRESUMED_INACTIVE',
        consecutiveMissCount: 10,
        lastSeenAt: '2026-01-01T12:00:00Z',
      });

      const result = await manager.recordSeen(
        'test-vendor',
        'listing-123',
        '2026-02-13T12:00:00Z',
        { ...defaultConfig, allowReactivation: false }
      );

      expect(result.newState).toBe('PRESUMED_INACTIVE');
      expect(result.changed).toBe(false);
    });
  });

  describe('recordMissed()', () => {
    it('increments miss count for ACTIVE listing', async () => {
      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-123',
        state: 'ACTIVE',
        consecutiveMissCount: 2,
        lastSeenAt: '2026-02-01T12:00:00Z',
      });

      const result = await manager.recordMissed(
        'test-vendor',
        'listing-123',
        defaultConfig
      );

      expect(result.newState).toBe('ACTIVE');
      expect(result.changed).toBe(false);

      const record = await repository.getLifecycleState('test-vendor', 'listing-123');
      expect(record!.consecutiveMissCount).toBe(3);
    });

    it('deactivates listing when miss threshold reached', async () => {
      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-123',
        state: 'ACTIVE',
        consecutiveMissCount: 4,
        lastSeenAt: '2026-02-01T12:00:00Z',
      });

      const result = await manager.recordMissed(
        'test-vendor',
        'listing-123',
        defaultConfig
      );

      expect(result.newState).toBe('PRESUMED_INACTIVE');
      expect(result.changed).toBe(true);

      const record = await repository.getLifecycleState('test-vendor', 'listing-123');
      expect(record!.state).toBe('PRESUMED_INACTIVE');
      expect(record!.markedInactiveAt).toBeDefined();
    });

    it('does not affect already inactive listings', async () => {
      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-123',
        state: 'VENDOR_INACTIVE',
        consecutiveMissCount: 10,
        lastSeenAt: '2026-01-01T12:00:00Z',
      });

      const result = await manager.recordMissed(
        'test-vendor',
        'listing-123',
        defaultConfig
      );

      expect(result.newState).toBe('VENDOR_INACTIVE');
      expect(result.changed).toBe(false);
    });
  });

  describe('applyVendorDeactivation()', () => {
    it('deactivates ACTIVE listing with reason', async () => {
      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-123',
        state: 'ACTIVE',
        consecutiveMissCount: 0,
        lastSeenAt: '2026-02-01T12:00:00Z',
      });

      const result = await manager.applyVendorDeactivation(
        'test-vendor',
        'listing-123',
        'Out of stock'
      );

      expect(result.newState).toBe('VENDOR_INACTIVE');
      expect(result.changed).toBe(true);

      const record = await repository.getLifecycleState('test-vendor', 'listing-123');
      expect(record!.state).toBe('VENDOR_INACTIVE');
      expect(record!.inactiveReason).toBe('Out of stock');
      expect(record!.markedInactiveAt).toBeDefined();
    });

    it('handles already inactive listing', async () => {
      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-123',
        state: 'VENDOR_INACTIVE',
        consecutiveMissCount: 0,
        lastSeenAt: '2026-01-01T12:00:00Z',
        inactiveReason: 'Previously out of stock',
      });

      const result = await manager.applyVendorDeactivation(
        'test-vendor',
        'listing-123',
        'Still out of stock'
      );

      expect(result.newState).toBe('VENDOR_INACTIVE');
      expect(result.changed).toBe(false);
    });
  });

  describe('detectStaleListings()', () => {
    it('detects listings not seen in stale period', async () => {
      const now = new Date('2026-02-13T12:00:00Z');
      const staleDate = new Date('2026-01-10T12:00:00Z'); // 34 days ago

      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-old',
        state: 'ACTIVE',
        consecutiveMissCount: 0,
        lastSeenAt: staleDate.toISOString(),
      });

      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-recent',
        state: 'ACTIVE',
        consecutiveMissCount: 0,
        lastSeenAt: now.toISOString(),
      });

      const result = await manager.detectStaleListings('test-vendor', defaultConfig);

      expect(result.totalStale).toBe(1);
      expect(result.deactivated).toBe(1);
      expect(result.deactivatedListings).toHaveLength(1);
      expect(result.deactivatedListings[0].vendorListingExternalId).toBe('listing-old');
    });

    it('does not affect non-stale listings', async () => {
      const now = new Date('2026-02-13T12:00:00Z');
      const recentDate = new Date('2026-02-10T12:00:00Z'); // 3 days ago

      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-recent',
        state: 'ACTIVE',
        consecutiveMissCount: 0,
        lastSeenAt: recentDate.toISOString(),
      });

      const result = await manager.detectStaleListings('test-vendor', defaultConfig);

      expect(result.totalStale).toBe(0);
      expect(result.deactivated).toBe(0);
    });

    it('only affects specified vendor', async () => {
      const staleDate = new Date('2026-01-01T12:00:00Z');

      repository.addRecord({
        vendorId: 'vendor-1',
        vendorListingExternalId: 'listing-1',
        state: 'ACTIVE',
        consecutiveMissCount: 0,
        lastSeenAt: staleDate.toISOString(),
      });

      repository.addRecord({
        vendorId: 'vendor-2',
        vendorListingExternalId: 'listing-2',
        state: 'ACTIVE',
        consecutiveMissCount: 0,
        lastSeenAt: staleDate.toISOString(),
      });

      const result = await manager.detectStaleListings('vendor-1', defaultConfig);

      expect(result.vendorId).toBe('vendor-1');
      expect(result.totalStale).toBe(1);

      // Verify vendor-2 listing is unaffected
      const vendor2Record = await repository.getLifecycleState('vendor-2', 'listing-2');
      expect(vendor2Record!.state).toBe('ACTIVE');
    });

    it('respects custom stale threshold', async () => {
      const now = new Date('2026-02-13T12:00:00Z');
      const date10DaysAgo = new Date('2026-02-03T12:00:00Z');

      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-1',
        state: 'ACTIVE',
        consecutiveMissCount: 0,
        lastSeenAt: date10DaysAgo.toISOString(),
      });

      const customConfig: LifecycleConfig = {
        ...defaultConfig,
        staleDaysThreshold: 7, // 7 days instead of 30
      };

      const result = await manager.detectStaleListings('test-vendor', customConfig);

      expect(result.totalStale).toBe(1);
      expect(result.deactivated).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('handles listing with no prior record', async () => {
      const result = await manager.recordMissed(
        'test-vendor',
        'new-listing',
        defaultConfig
      );

      // Should create new record with miss count of 1
      const record = await repository.getLifecycleState('test-vendor', 'new-listing');
      expect(record).toBeDefined();
      expect(record!.consecutiveMissCount).toBe(1);
    });

    it('handles empty stale detection result', async () => {
      const result = await manager.detectStaleListings('test-vendor', defaultConfig);

      expect(result.totalActive).toBe(0);
      expect(result.totalStale).toBe(0);
      expect(result.deactivated).toBe(0);
      expect(result.deactivatedListings).toEqual([]);
    });

    it('resets miss count when listing seen again', async () => {
      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-123',
        state: 'ACTIVE',
        consecutiveMissCount: 4,
        lastSeenAt: '2026-02-01T12:00:00Z',
      });

      await manager.recordSeen(
        'test-vendor',
        'listing-123',
        '2026-02-13T12:00:00Z',
        defaultConfig
      );

      const record = await repository.getLifecycleState('test-vendor', 'listing-123');
      expect(record!.consecutiveMissCount).toBe(0);
    });

    it('handles concurrent deactivation attempts', async () => {
      repository.addRecord({
        vendorId: 'test-vendor',
        vendorListingExternalId: 'listing-123',
        state: 'ACTIVE',
        consecutiveMissCount: 0,
        lastSeenAt: '2026-02-01T12:00:00Z',
      });

      const result1 = await manager.applyVendorDeactivation(
        'test-vendor',
        'listing-123',
        'Reason 1'
      );

      const result2 = await manager.applyVendorDeactivation(
        'test-vendor',
        'listing-123',
        'Reason 2'
      );

      expect(result1.changed).toBe(true);
      expect(result2.changed).toBe(false); // Already inactive
    });
  });
});
