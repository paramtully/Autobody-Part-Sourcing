/**
 * Unit tests for DomainReconciler and ConflictResolver.
 * 
 * Tests cover:
 * - INSERT action (new listings)
 * - UPDATE action (changed listings)
 * - SKIP action (unchanged listings)
 * - CONFLICT detection and resolution
 * - Price anomaly detection
 * - Condition downgrade detection
 * - Interchange mismatch handling
 * - Batch reconciliation
 * - Edge cases
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  DefaultDomainReconciler,
  type DomainReconciler,
  type ReconciliationRepository,
  type ExistingListingState,
} from '../domainReconciler';
import {
  ConfigurableConflictResolver,
  type ConflictResolver,
  type ConflictResolution,
} from '../conflictResolver';
import { markAsCleaned, type CleanedDTO } from '../../cleaning/cleanedDTO';
import type { VendorInventoryDTO } from '../../dto/vendorInventoryDTO';
import type { ReconciliationResult } from '../reconciliationResult';

/**
 * Mock repository for testing.
 */
class MockReconciliationRepository implements ReconciliationRepository {
  private listings = new Map<string, ExistingListingState>();
  private hashIndex = new Map<string, ExistingListingState>();

  async findByVendorListing(
    vendorId: string,
    vendorListingExternalId: string
  ): Promise<ExistingListingState | null> {
    const key = `${vendorId}:${vendorListingExternalId}`;
    return this.listings.get(key) ?? null;
  }

  async findByPayloadHash(vendorId: string, payloadHash: string): Promise<ExistingListingState | null> {
    const key = `${vendorId}:${payloadHash}`;
    return this.hashIndex.get(key) ?? null;
  }

  // Test helpers
  addListing(state: ExistingListingState): void {
    const key = `${state.vendorId}:${state.listingId}`;
    this.listings.set(key, state);

    const hashKey = `${state.vendorId}:${state.payloadHash}`;
    this.hashIndex.set(hashKey, state);
  }

  reset(): void {
    this.listings.clear();
    this.hashIndex.clear();
  }
}

const createCleanedDTO = (overrides?: Partial<VendorInventoryDTO>): CleanedDTO => {
  const dto: VendorInventoryDTO = {
    vendorId: 'test-vendor',
    vendorListingExternalId: 'listing-123',
    sourceUrl: 'https://vendor.com/listing/123',
    normalizedPartNumberCandidates: ['OEM-456'],
    canonicalPayloadJson: '{"price":10000}',
    payloadHash: 'hash-abc123',
    ingestedAt: '2026-02-13T12:00:00Z',
    condition: 'NEW_OEM',
    availabilityStatus: 'IN_STOCK',
    isActive: true,
    priceMinorMin: 10000,
    currency: 'USD',
    dataSource: 'VENDOR_API',
    ...overrides,
  };
  return markAsCleaned(dto);
};

const createExistingState = (overrides?: Partial<ExistingListingState>): ExistingListingState => ({
  listingId: 'listing-123',
  payloadHash: 'hash-old',
  priceMinorMin: 10000,
  condition: 'NEW_OEM',
  availabilityStatus: 'IN_STOCK',
  vendorId: 'test-vendor',
  lastUpdatedAt: '2026-02-01T12:00:00Z',
  ...overrides,
});

describe('ConfigurableConflictResolver', () => {
  let resolver: ConfigurableConflictResolver;

  beforeEach(() => {
    resolver = new ConfigurableConflictResolver();
  });

  describe('Default Resolution', () => {
    it('uses global default for unknown conflicts', () => {
      const conflict = {
        type: 'PRICE_ANOMALY' as const,
        field: 'priceMinorMin',
        existingValue: 10000,
        incomingValue: 20000,
        message: 'Price anomaly detected',
      };

      const result = resolver.resolve(conflict, 'test-vendor');

      expect(result.resolution).toBe('FLAG_FOR_REVIEW');
      expect(result.reason).toContain('Price changed');
    });

    it('allows custom global default', () => {
      const customResolver = new ConfigurableConflictResolver({
        defaultResolution: 'ACCEPT_INCOMING',
      });

      const conflict = {
        type: 'INTERCHANGE_MISMATCH' as const,
        field: 'interchangeCode',
        existingValue: 'OLD-123',
        incomingValue: 'NEW-456',
        message: 'Mismatch',
      };

      const result = customResolver.resolve(conflict, 'test-vendor');

      expect(result.resolution).toBe('ACCEPT_INCOMING');
    });
  });

  describe('Vendor-Specific Configuration', () => {
    it('applies vendor-specific overrides', () => {
      resolver.setVendorConfig('lkq', {
        defaultResolution: 'ACCEPT_INCOMING',
        overrides: {
          INTERCHANGE_MISMATCH: 'ACCEPT_INCOMING',
        },
      });

      const conflict = {
        type: 'INTERCHANGE_MISMATCH' as const,
        field: 'interchangeCode',
        existingValue: 'OLD-123',
        incomingValue: 'NEW-456',
        message: 'Mismatch',
      };

      const result = resolver.resolve(conflict, 'lkq');

      expect(result.resolution).toBe('ACCEPT_INCOMING');
      expect(result.reason).toContain('explicit resolution');
    });

    it('uses global default for unconfigured vendors', () => {
      resolver.setVendorConfig('lkq', {
        defaultResolution: 'ACCEPT_INCOMING',
      });

      const conflict = {
        type: 'INTERCHANGE_MISMATCH' as const,
        field: 'interchangeCode',
        existingValue: 'OLD',
        incomingValue: 'NEW',
        message: 'Mismatch',
      };

      const result = resolver.resolve(conflict, 'other-vendor');

      expect(result.resolution).toBe('FLAG_FOR_REVIEW'); // Global default
    });
  });

  describe('Conflict Type Handling', () => {
    it('handles PRICE_ANOMALY', () => {
      const conflict = {
        type: 'PRICE_ANOMALY' as const,
        field: 'priceMinorMin',
        existingValue: 10000,
        incomingValue: 20000,
        message: 'Price anomaly',
      };

      const result = resolver.resolve(conflict, 'test-vendor');

      expect(result.resolution).toBe('FLAG_FOR_REVIEW');
    });

    it('handles CONDITION_DOWNGRADE', () => {
      const conflict = {
        type: 'CONDITION_DOWNGRADE' as const,
        field: 'condition',
        existingValue: 'NEW_OEM',
        incomingValue: 'RECYCLED',
        message: 'Downgrade',
      };

      const result = resolver.resolve(conflict, 'test-vendor');

      expect(result.resolution).toBe('FLAG_FOR_REVIEW');
    });

    it('handles IDENTITY_COLLISION', () => {
      const conflict = {
        type: 'IDENTITY_COLLISION' as const,
        field: 'canonicalPartId',
        existingValue: 'part-1',
        incomingValue: 'part-2',
        message: 'Collision',
      };

      const result = resolver.resolve(conflict, 'test-vendor');

      expect(result.resolution).toBe('REJECT');
    });

    it('handles DUPLICATE_LISTING', () => {
      const conflict = {
        type: 'DUPLICATE_LISTING' as const,
        field: 'vendorListingExternalId',
        existingValue: 'listing-123',
        incomingValue: 'listing-123',
        message: 'Duplicate',
      };

      const result = resolver.resolve(conflict, 'test-vendor');

      expect(result.resolution).toBe('KEEP_EXISTING');
    });
  });
});

describe('DefaultDomainReconciler', () => {
  let repository: MockReconciliationRepository;
  let conflictResolver: ConflictResolver;
  let reconciler: DomainReconciler;

  beforeEach(() => {
    repository = new MockReconciliationRepository();
    conflictResolver = new ConfigurableConflictResolver();
    reconciler = new DefaultDomainReconciler(repository, conflictResolver);
  });

  describe('INSERT Action', () => {
    it('returns INSERT for new listing', async () => {
      const dto = createCleanedDTO();

      const result = await reconciler.reconcile(dto);

      expect(result.action).toBe('INSERT');
      expect(result.vendorId).toBe('test-vendor');
      expect(result.vendorListingExternalId).toBe('listing-123');
    });

    it('returns INSERT when no external ID provided', async () => {
      const dto = createCleanedDTO({
        vendorListingExternalId: undefined,
      });

      const result = await reconciler.reconcile(dto);

      expect(result.action).toBe('INSERT');
    });

    it('includes empty changeset and conflicts for INSERT', async () => {
      const dto = createCleanedDTO();

      const result = await reconciler.reconcile(dto);

      expect(result.changeset).toEqual([]);
      expect(result.conflicts).toEqual([]);
    });
  });

  describe('SKIP Action', () => {
    it('returns SKIP when payload hash unchanged', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-unchanged',
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-unchanged',
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.action).toBe('SKIP');
      expect(result.changeset).toEqual([]);
    });

    it('includes existing listing ID for SKIP', async () => {
      const dto = createCleanedDTO({ payloadHash: 'hash-same' });

      repository.addListing(
        createExistingState({
          listingId: 'existing-id-789',
          payloadHash: 'hash-same',
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.action).toBe('SKIP');
      expect(result.existingListingId).toBe('existing-id-789');
    });
  });

  describe('UPDATE Action', () => {
    it('returns UPDATE when payload hash changed', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-new',
        priceMinorMin: 12000,
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-old',
          priceMinorMin: 10000,
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.action).toBe('UPDATE');
    });

    it('includes changeset for UPDATE', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-new',
        priceMinorMin: 12000,
        condition: 'RECYCLED',
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-old',
          priceMinorMin: 10000,
          condition: 'NEW_OEM',
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.action).toBe('UPDATE');
      expect(result.changeset).toBeDefined();
      expect(result.changeset!.length).toBeGreaterThan(0);
    });

    it('includes existing listing ID for UPDATE', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-new',
      });

      repository.addListing(
        createExistingState({
          listingId: 'existing-id-456',
          payloadHash: 'hash-old',
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.action).toBe('UPDATE');
      expect(result.existingListingId).toBe('existing-id-456');
    });
  });

  describe('Conflict Detection', () => {
    it('detects price anomaly', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-new',
        priceMinorMin: 20000, // Double the price
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-old',
          priceMinorMin: 10000,
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.conflicts).toBeDefined();
      expect(result.conflicts!.length).toBeGreaterThan(0);
      expect(result.conflicts![0].type).toBe('PRICE_ANOMALY');
    });

    it('detects condition downgrade', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-new',
        condition: 'RECYCLED',
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-old',
          condition: 'NEW_OEM',
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.conflicts).toBeDefined();
      expect(result.conflicts!.some(c => c.type === 'CONDITION_DOWNGRADE')).toBe(true);
    });

    it('detects interchange mismatch', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-new',
        interchange: {
          system: 'hollander',
          code: 'NEW-123',
        },
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-old',
          interchangeSystem: 'hollander',
          interchangeCode: 'OLD-456',
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.conflicts).toBeDefined();
      expect(result.conflicts!.some(c => c.type === 'INTERCHANGE_MISMATCH')).toBe(true);
    });
  });

  describe('Batch Reconciliation', () => {
    it('processes batch of DTOs', async () => {
      const dtos = [
        createCleanedDTO({ vendorListingExternalId: 'listing-1' }),
        createCleanedDTO({ vendorListingExternalId: 'listing-2' }),
        createCleanedDTO({ vendorListingExternalId: 'listing-3' }),
      ];

      const summary = await reconciler.reconcileBatch(dtos);

      expect(summary.totalProcessed).toBe(3);
      expect(summary.results).toHaveLength(3);
    });

    it('aggregates action counts', async () => {
      const dtos = [
        createCleanedDTO({ vendorListingExternalId: 'new-1' }),
        createCleanedDTO({ vendorListingExternalId: 'existing-1', payloadHash: 'hash-same' }),
        createCleanedDTO({ vendorListingExternalId: 'existing-2', payloadHash: 'hash-new' }),
      ];

      repository.addListing(
        createExistingState({
          listingId: 'existing-1',
          payloadHash: 'hash-same',
        })
      );

      repository.addListing(
        createExistingState({
          listingId: 'existing-2',
          payloadHash: 'hash-old',
        })
      );

      const summary = await reconciler.reconcileBatch(dtos);

      expect(summary.insertCount).toBe(1);
      expect(summary.updateCount).toBe(1);
      expect(summary.skipCount).toBe(1);
    });

    it('tracks conflicts in batch', async () => {
      const dtos = [
        createCleanedDTO({
          vendorListingExternalId: 'listing-1',
          payloadHash: 'hash-new',
          priceMinorMin: 20000,
        }),
      ];

      repository.addListing(
        createExistingState({
          listingId: 'listing-1',
          payloadHash: 'hash-old',
          priceMinorMin: 10000,
        })
      );

      const summary = await reconciler.reconcileBatch(dtos);

      expect(summary.conflictCount).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('handles missing optional fields', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-new',
        quantityAvailable: undefined,
        description: undefined,
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-old',
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.action).toBe('UPDATE');
    });

    it('handles zero price correctly', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-new',
        priceMinorMin: 0,
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-old',
          priceMinorMin: 10000,
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.action).toBe('UPDATE');
    });

    it('handles empty changeset gracefully', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-new', // Hash changed but fields identical
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-old',
          priceMinorMin: 10000,
          condition: 'NEW_OEM',
          availabilityStatus: 'IN_STOCK',
        })
      );

      const result = await reconciler.reconcile(dto);

      // Should still UPDATE because hash changed
      expect(result.action).toBe('UPDATE');
    });

    it('handles null vs undefined gracefully', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-new',
        quantityAvailable: undefined,
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-old',
          quantityAvailable: undefined,
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.action).toBe('UPDATE');
    });
  });

  describe('Price Anomaly Threshold', () => {
    it('uses custom anomaly threshold', async () => {
      const customReconciler = new DefaultDomainReconciler(
        repository,
        conflictResolver,
        0.2 // 20% threshold
      );

      const dto = createCleanedDTO({
        payloadHash: 'hash-new',
        priceMinorMin: 13000, // 30% increase
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-old',
          priceMinorMin: 10000,
        })
      );

      const result = await customReconciler.reconcile(dto);

      expect(result.conflicts!.some(c => c.type === 'PRICE_ANOMALY')).toBe(true);
    });

    it('does not flag small price changes', async () => {
      const dto = createCleanedDTO({
        payloadHash: 'hash-new',
        priceMinorMin: 10500, // 5% increase
      });

      repository.addListing(
        createExistingState({
          listingId: 'listing-123',
          payloadHash: 'hash-old',
          priceMinorMin: 10000,
        })
      );

      const result = await reconciler.reconcile(dto);

      expect(result.conflicts).toEqual([]);
    });
  });
});
