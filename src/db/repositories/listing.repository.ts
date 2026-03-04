import { eq, and, gte, lte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client';
import {
  listings,
  listingImages,
  vendors,
  parts,
  warehouseLocations,
  partFitments,
  fitments,
  partIdentifiers,
} from '../schema';

// ── Types ────────────────────────────────────────────────────────

export type ListingRow = typeof listings.$inferSelect;
export type ListingInsert = typeof listings.$inferInsert;

export interface ListingWithRelations extends ListingRow {
  vendor: typeof vendors.$inferSelect;
  // The specific identifier this listing is selling (contains brand/manufacturer)
  partIdentifier: typeof partIdentifiers.$inferSelect;
  // The canonical part (name, category, position) reached via partIdentifier.partId
  part: typeof parts.$inferSelect;
  // All identifiers for this part (OEM, aftermarket, interchange alternatives)
  allIdentifiers: (typeof partIdentifiers.$inferSelect)[];
  images: (typeof listingImages.$inferSelect)[];
  warehouseLocation: typeof warehouseLocations.$inferSelect | null;
}

export interface ListingFilters {
  condition?: string;
  availabilityStatus?: string;
  vendorId?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  isActive?: boolean;
}

export interface Fitment {
  make: string;
  model: string;
  year: number;
  trim?: string;
}

export interface UpsertListingData {
  vendorId: string;
  partIdentifierId: string;
  vendorListingExternalId: string;
  sourceUrl?: string;
  condition: ListingInsert['condition'];
  description?: string;
  quantityAvailable?: number;
  availabilityStatus: ListingInsert['availabilityStatus'];
  priceMinorMin: number;
  priceMinorMax?: number;
  currency: ListingInsert['currency'];
  source: ListingInsert['source'];
  warehouseLocationId?: string;
  estimatedShipTimeHours?: number;
  confidenceScore?: number;
  payloadHash?: string;
  isActive?: boolean;
}

// ── Interface ─────────────────────────────────────────────────────

export interface IListingRepository {
  findById(id: string): Promise<ListingWithRelations | null>;
  findByFitment(fitment: Fitment, filters?: ListingFilters, limit?: number, offset?: number): Promise<ListingWithRelations[]>;
  findByPartNumber(partNumber: string, filters?: ListingFilters, limit?: number, offset?: number): Promise<ListingWithRelations[]>;
  upsertFromIngestion(data: UpsertListingData): Promise<{ listingId: string }>;
  markStaleInactive(vendorId: string, notSeenSince: Date): Promise<number>;
}

// ── Repository ───────────────────────────────────────────────────

export class ListingRepo implements IListingRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<ListingWithRelations | null> {
    const rows = await this.fetchWithRelations([id]);
    return rows[0] ?? null;
  }

  /** Search listings by vehicle fitment (make/model/year/trim).
   *  Path: fitments → partFitments → parts → partIdentifiers → listings */
  async findByFitment(
    fitment: Fitment,
    filters: ListingFilters = {},
    limit = 50,
    offset = 0,
  ): Promise<ListingWithRelations[]> {
    // Step 1: resolve fitment ids
    const fitmentRows = await this.db
      .select({ fitmentId: fitments.id })
      .from(fitments)
      .where(
        and(
          eq(fitments.make, fitment.make),
          eq(fitments.model, fitment.model),
          eq(fitments.year, fitment.year),
          fitment.trim ? eq(fitments.trim, fitment.trim) : sql`true`,
        ),
      );

    if (fitmentRows.length === 0) return [];

    // Step 2: get part ids via part_fitments join
    const pfRows = await this.db
      .select({ partId: partFitments.partId })
      .from(partFitments)
      .where(inArray(partFitments.fitmentId, fitmentRows.map((r) => r.fitmentId)));

    if (pfRows.length === 0) return [];
    const partIds = [...new Set(pfRows.map((r) => r.partId))];

    // Step 3: get partIdentifier ids for those parts
    const piRows = await this.db
      .select({ id: partIdentifiers.id })
      .from(partIdentifiers)
      .where(inArray(partIdentifiers.partId, partIds));

    if (piRows.length === 0) return [];
    const partIdentifierIds = piRows.map((r) => r.id);

    return this.findByPartIdentifierIds(partIdentifierIds, filters, limit, offset);
  }

  /** Search listings by any OEM, aftermarket, or interchange part number value. */
  async findByPartNumber(
    partNumber: string,
    filters: ListingFilters = {},
    limit = 50,
    offset = 0,
  ): Promise<ListingWithRelations[]> {
    const piRows = await this.db
      .select({ id: partIdentifiers.id })
      .from(partIdentifiers)
      .where(eq(partIdentifiers.value, partNumber));

    if (piRows.length === 0) return [];
    const partIdentifierIds = piRows.map((r) => r.id);

    return this.findByPartIdentifierIds(partIdentifierIds, filters, limit, offset);
  }

  /** Upsert a listing during ingestion. Uses ON CONFLICT DO UPDATE keyed by
   *  (vendor_id, vendor_listing_external_id). Updates price/availability/hash. */
  async upsertFromIngestion(data: UpsertListingData): Promise<{ listingId: string }> {
    const now = new Date();
    const values: ListingInsert = {
      vendorId: data.vendorId,
      partIdentifierId: data.partIdentifierId,
      vendorListingExternalId: data.vendorListingExternalId,
      sourceUrl: data.sourceUrl,
      condition: data.condition,
      description: data.description,
      quantityAvailable: data.quantityAvailable,
      availabilityStatus: data.availabilityStatus,
      priceMinorMin: data.priceMinorMin,
      priceMinorMax: data.priceMinorMax,
      currency: data.currency,
      source: data.source,
      warehouseLocationId: data.warehouseLocationId,
      estimatedShipTimeHours: data.estimatedShipTimeHours,
      confidenceScore: data.confidenceScore?.toString(),
      payloadHash: data.payloadHash,
      isActive: data.isActive ?? true,
      lastVerifiedAt: now,
      lastSeenAt: now,
    };

    const [row] = await this.db
      .insert(listings)
      .values(values)
      .onConflictDoUpdate({
        target: [listings.vendorId, listings.vendorListingExternalId],
        set: {
          availabilityStatus: data.availabilityStatus,
          priceMinorMin: data.priceMinorMin,
          priceMinorMax: data.priceMinorMax,
          quantityAvailable: data.quantityAvailable,
          estimatedShipTimeHours: data.estimatedShipTimeHours,
          confidenceScore: data.confidenceScore?.toString(),
          isActive: data.isActive ?? true,
          payloadHash: data.payloadHash,
          lastVerifiedAt: now,
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .returning({ listingId: listings.id });

    return row;
  }

  /** Mark listings inactive for a vendor that weren't seen since a given date. */
  async markStaleInactive(vendorId: string, notSeenSince: Date): Promise<number> {
    const result = await this.db
      .update(listings)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(listings.vendorId, vendorId),
          eq(listings.isActive, true),
          sql`${listings.lastSeenAt} < ${notSeenSince}`,
        ),
      )
      .returning({ id: listings.id });

    return result.length;
  }

  // ── Private helpers ────────────────────────────────────────────

  private async findByPartIdentifierIds(
    partIdentifierIds: string[],
    filters: ListingFilters,
    limit: number,
    offset: number,
  ): Promise<ListingWithRelations[]> {
    const conditions = [
      inArray(listings.partIdentifierId, partIdentifierIds),
      ...(filters.isActive !== undefined ? [eq(listings.isActive, filters.isActive)] : []),
      ...(filters.condition ? [eq(listings.condition, filters.condition as ListingRow['condition'])] : []),
      ...(filters.availabilityStatus
        ? [eq(listings.availabilityStatus, filters.availabilityStatus as ListingRow['availabilityStatus'])]
        : []),
      ...(filters.vendorId ? [eq(listings.vendorId, filters.vendorId)] : []),
      ...(filters.minPriceMinor !== undefined
        ? [gte(listings.priceMinorMin, filters.minPriceMinor)]
        : []),
      ...(filters.maxPriceMinor !== undefined
        ? [lte(listings.priceMinorMin, filters.maxPriceMinor)]
        : []),
    ];

    const rows = await this.db
      .select({ id: listings.id })
      .from(listings)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);

    if (rows.length === 0) return [];
    return this.fetchWithRelations(rows.map((r) => r.id));
  }

  private async fetchWithRelations(ids: string[]): Promise<ListingWithRelations[]> {
    if (ids.length === 0) return [];

    const listingRows = await this.db
      .select()
      .from(listings)
      .where(inArray(listings.id, ids));

    if (listingRows.length === 0) return [];

    const vendorIds = [...new Set(listingRows.map((l) => l.vendorId))];
    const piIds = [...new Set(listingRows.map((l) => l.partIdentifierId))];
    const wlIds = listingRows
      .map((l) => l.warehouseLocationId)
      .filter((id): id is string => id != null);

    // Fetch partIdentifiers for these listings
    const piRows = await this.db
      .select()
      .from(partIdentifiers)
      .where(inArray(partIdentifiers.id, piIds));

    // Fetch parts via partIdentifier.partId
    const partIds = [...new Set(piRows.map((pi) => pi.partId))];

    const [vendorRows, partRows, wlRows, imageRows, allPiRows] = await Promise.all([
      this.db.select().from(vendors).where(inArray(vendors.id, vendorIds)),
      this.db.select().from(parts).where(inArray(parts.id, partIds)),
      wlIds.length
        ? this.db.select().from(warehouseLocations).where(inArray(warehouseLocations.id, wlIds))
        : Promise.resolve([]),
      this.db.select().from(listingImages).where(inArray(listingImages.listingId, ids)),
      // All identifiers for these parts (for showing alternatives to the body shop)
      this.db.select().from(partIdentifiers).where(inArray(partIdentifiers.partId, partIds)),
    ]);

    const vendorMap = new Map(vendorRows.map((v) => [v.id, v]));
    const partMap = new Map(partRows.map((p) => [p.id, p]));
    const wlMap = new Map(wlRows.map((wl) => [wl.id, wl]));
    const piMap = new Map(piRows.map((pi) => [pi.id, pi]));

    const imagesByListing = new Map<string, (typeof listingImages.$inferSelect)[]>();
    for (const img of imageRows) {
      const arr = imagesByListing.get(img.listingId) ?? [];
      arr.push(img);
      imagesByListing.set(img.listingId, arr);
    }

    const allPisByPart = new Map<string, (typeof partIdentifiers.$inferSelect)[]>();
    for (const pi of allPiRows) {
      const arr = allPisByPart.get(pi.partId) ?? [];
      arr.push(pi);
      allPisByPart.set(pi.partId, arr);
    }

    return listingRows.map((listing) => {
      const partIdentifier = piMap.get(listing.partIdentifierId)!;
      return {
        ...listing,
        vendor: vendorMap.get(listing.vendorId)!,
        partIdentifier,
        part: partMap.get(partIdentifier.partId)!,
        allIdentifiers: allPisByPart.get(partIdentifier.partId) ?? [],
        images: imagesByListing.get(listing.id) ?? [],
        warehouseLocation: listing.warehouseLocationId
          ? (wlMap.get(listing.warehouseLocationId) ?? null)
          : null,
      };
    });
  }
}
