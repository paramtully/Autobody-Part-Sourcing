import type {
  IListingRepository,
  ListingWithRelations,
  ListingFilters,
  Fitment,
  UpsertListingData,
} from '../repositories/listing.repository';

/**
 * In-memory implementation of IListingRepository for use in unit tests.
 *
 * Usage:
 *   import { FIXTURE_LISTINGS } from './fixtures';
 *   const repo = new MockListingRepository(FIXTURE_LISTINGS);
 */
export class MockListingRepository implements IListingRepository {
  private listings: ListingWithRelations[];

  constructor(seed: ListingWithRelations[] = []) {
    // Shallow-clone so tests don't share mutable state
    this.listings = seed.map((l) => ({ ...l }));
  }

  async findById(id: string): Promise<ListingWithRelations | null> {
    return this.listings.find((l) => l.id === id) ?? null;
  }

  /**
   * Fitment-to-part join is not simulated in-memory.
   * Returns all listings that pass the filters, which is sufficient for
   * testing service-layer logic that doesn't care about fitment resolution.
   */
  async findByFitment(
    _fitment: Fitment,
    filters: ListingFilters = {},
    limit = 50,
    offset = 0,
  ): Promise<ListingWithRelations[]> {
    return this.applyFilters(this.listings, filters).slice(offset, offset + limit);
  }

  async findByPartNumber(
    partNumber: string,
    filters: ListingFilters = {},
    limit = 50,
    offset = 0,
  ): Promise<ListingWithRelations[]> {
    const matched = this.listings.filter((l) =>
      l.allIdentifiers.some((pi) => pi.value === partNumber),
    );
    return this.applyFilters(matched, filters).slice(offset, offset + limit);
  }

  async upsertFromIngestion(data: UpsertListingData): Promise<{ listingId: string }> {
    const existing = this.listings.find(
      (l) =>
        l.vendorId === data.vendorId &&
        l.vendorListingExternalId === data.vendorListingExternalId,
    );

    if (existing) {
      Object.assign(existing, {
        availabilityStatus: data.availabilityStatus,
        priceMinorMin: data.priceMinorMin,
        priceMinorMax: data.priceMinorMax ?? null,
        quantityAvailable: data.quantityAvailable ?? null,
        estimatedShipTimeHours: data.estimatedShipTimeHours ?? null,
        confidenceScore: data.confidenceScore?.toString() ?? null,
        isActive: data.isActive ?? true,
        payloadHash: data.payloadHash ?? null,
        lastVerifiedAt: new Date(),
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      });
      return { listingId: existing.id };
    }

    // New listing — relations are left empty; ingestion tests only need the id
    const listingId = `mock-listing-${Date.now()}`;
    return { listingId };
  }

  async markStaleInactive(vendorId: string, notSeenSince: Date): Promise<number> {
    let count = 0;
    for (const l of this.listings) {
      if (l.vendorId === vendorId && l.isActive && l.lastSeenAt < notSeenSince) {
        l.isActive = false;
        count++;
      }
    }
    return count;
  }

  // ── Test helpers ──────────────────────────────────────────────────

  /** Returns the current in-memory state (useful for assertions). */
  all(): ListingWithRelations[] {
    return this.listings;
  }

  // ── Private ───────────────────────────────────────────────────────

  private applyFilters(
    listings: ListingWithRelations[],
    filters: ListingFilters,
  ): ListingWithRelations[] {
    return listings.filter((l) => {
      if (filters.isActive !== undefined && l.isActive !== filters.isActive) return false;
      if (filters.condition && l.condition !== filters.condition) return false;
      if (filters.availabilityStatus && l.availabilityStatus !== filters.availabilityStatus) return false;
      if (filters.vendorId && l.vendorId !== filters.vendorId) return false;
      if (filters.minPriceMinor !== undefined && l.priceMinorMin < filters.minPriceMinor) return false;
      if (filters.maxPriceMinor !== undefined && l.priceMinorMin > filters.maxPriceMinor) return false;
      return true;
    });
  }
}
