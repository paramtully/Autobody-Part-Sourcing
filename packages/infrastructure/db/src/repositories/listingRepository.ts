import { db } from '../db';
import { listings, vendors, parts, warehouseLocations } from '../schema';
import { eq, and, or, inArray, gte, lte, sql } from 'drizzle-orm';
import type { ListingRepository } from '@interfaces/repositories/listingRepository';
import type Listing from '@domain/listing/listing';
import type { ListingFilters } from '@interfaces/repositories/listingRepository';
import type { Fitment } from '@domain/fitment/fitment';
import { PartCategory } from '@domain/part/partCategory';
import { InterchangeSystem } from '@domain/interchange/interchange';
import type { PaginationParams, PaginatedResult } from '@interfaces/repositories/pagination';
import { toDomainListing, toDbListingInsert, type ListingAggregateData } from '../mappers';
import { normalizeLimit, createPaginatedResult } from './paginationHelper';
import type { PartRepository } from '@interfaces/repositories/partRepository';
import { PartRepositoryImpl } from './partRepository';

export class ListingRepositoryImpl implements ListingRepository {
    private partRepository: PartRepository;

    constructor(partRepository?: PartRepository) {
        this.partRepository = partRepository || new PartRepositoryImpl();
    }

    async upsert(
        listing: Omit<Listing, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<Listing> {
        const insertData = toDbListingInsert(listing);

        // Try to find existing by vendorListingExternalId or sourceUrl
        let existingId: string | null = null;

        if (insertData.vendorListingExternalId) {
            const existing = await db
                .select({ id: listings.id })
                .from(listings)
                .where(
                    and(
                        eq(listings.vendorId, insertData.vendorId),
                        eq(listings.vendorListingExternalId, insertData.vendorListingExternalId)
                    )
                )
                .limit(1);
            if (existing.length > 0) {
                existingId = existing[0].id;
            }
        }

        if (!existingId && insertData.sourceUrl) {
            const existing = await db
                .select({ id: listings.id })
                .from(listings)
                .where(
                    and(
                        eq(listings.vendorId, insertData.vendorId),
                        eq(listings.sourceUrl, insertData.sourceUrl)
                    )
                )
                .limit(1);
            if (existing.length > 0) {
                existingId = existing[0].id;
            }
        }

        let listingRow;
        if (existingId) {
            // Update existing
            [listingRow] = await db
                .update(listings)
                .set({
                    ...insertData,
                    updatedAt: new Date(),
                })
                .where(eq(listings.id, existingId))
                .returning();
        } else {
            // Insert new
            [listingRow] = await db
                .insert(listings)
                .values(insertData)
                .returning();
        }

        return await this.fetchListingWithRelations(listingRow.id);
    }

    async findById(id: string): Promise<Listing | null> {
        return await this.fetchListingWithRelations(id);
    }

    async findByPart(
        partId: string,
        filters?: ListingFilters,
        pagination?: PaginationParams
    ): Promise<Listing[] | PaginatedResult<Listing>> {
        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        let query = db
            .select({ listing: listings })
            .from(listings)
            .where(eq(listings.partId, partId));

        // Apply filters
        if (filters) {
            if (filters.condition) {
                query = query.where(and(eq(listings.condition, filters.condition)));
            }
            if (filters.availabilityStatus) {
                query = query.where(and(eq(listings.availabilityStatus, filters.availabilityStatus)));
            }
            if (filters.vendorId) {
                query = query.where(and(eq(listings.vendorId, filters.vendorId)));
            }
            if (filters.minPriceMinor !== undefined) {
                query = query.where(and(gte(listings.priceMinorMin, filters.minPriceMinor)));
            }
            if (filters.maxPriceMinor !== undefined) {
                query = query.where(and(lte(listings.priceMinorMin, filters.maxPriceMinor)));
            }
            if (filters.currency) {
                query = query.where(and(eq(listings.currency, filters.currency)));
            }
        }

        const rows = await query.limit(limit + 1).offset(offset);
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const listingIds = pageRows.map((row) => row.listing.id);

        if (listingIds.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        const items = await this.fetchListingsWithRelations(listingIds);

        if (!pagination) return items;
        return createPaginatedResult(items, pagination, hasMore);
    }

    async findByVendorAndPart(
        vendorId: string,
        partId: string,
        pagination?: PaginationParams
    ): Promise<Listing[] | PaginatedResult<Listing>> {
        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        const rows = await db
            .select({ listing: listings })
            .from(listings)
            .where(and(eq(listings.vendorId, vendorId), eq(listings.partId, partId)))
            .limit(limit + 1)
            .offset(offset);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const listingIds = pageRows.map((row) => row.listing.id);

        if (listingIds.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        const items = await this.fetchListingsWithRelations(listingIds);

        if (!pagination) return items;
        return createPaginatedResult(items, pagination, hasMore);
    }

    async findByOemPartNumber(
        partNumber: string,
        manufacturer?: string,
        filters?: ListingFilters,
        pagination?: PaginationParams
    ): Promise<Listing[] | PaginatedResult<Listing>> {
        // Two-step: find parts first, then listings
        const partResult = await this.partRepository.findByOemPartNumber(
            partNumber,
            manufacturer,
            pagination
        );

        const partList = Array.isArray(partResult) ? partResult : partResult.items;
        if (partList.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        const partIds = partList.map((p) => (p as any).id || '').filter(Boolean);
        if (partIds.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        // Find listings for these parts
        return this.findListingsByPartIds(partIds, filters, pagination);
    }

    async findByAftermarketPartNumber(
        partNumber: string,
        manufacturer?: string,
        filters?: ListingFilters,
        pagination?: PaginationParams
    ): Promise<Listing[] | PaginatedResult<Listing>> {
        // Two-step: find parts first, then listings
        const partResult = await this.partRepository.findByAftermarketPartNumber(
            partNumber,
            manufacturer,
            pagination
        );

        const partList = Array.isArray(partResult) ? partResult : partResult.items;
        if (partList.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        const partIds = partList.map((p) => (p as any).id || '').filter(Boolean);
        if (partIds.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        // Find listings for these parts
        return this.findListingsByPartIds(partIds, filters, pagination);
    }

    async findByInterchangeCode(
        system: InterchangeSystem,
        code: string,
        filters?: ListingFilters,
        pagination?: PaginationParams
    ): Promise<Listing[] | PaginatedResult<Listing>> {
        // Two-step: find parts first, then listings
        const partResult = await this.partRepository.findByInterchangeCode(system, code, pagination);

        const partList = Array.isArray(partResult) ? partResult : partResult.items;
        if (partList.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        const partIds = partList.map((p) => (p as any).id || '').filter(Boolean);
        if (partIds.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        // Find listings for these parts
        return this.findListingsByPartIds(partIds, filters, pagination);
    }

    async findByFitment(
        fitment: Fitment,
        category?: PartCategory,
        filters?: ListingFilters,
        pagination?: PaginationParams
    ): Promise<Listing[] | PaginatedResult<Listing>> {
        // Two-step: find parts first (with pagination), then listings
        const partResult = await this.partRepository.findByFitment(fitment, category, pagination);

        const partList = Array.isArray(partResult) ? partResult : partResult.items;
        if (partList.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        const partIds = partList.map((p) => (p as any).id || '').filter(Boolean);
        if (partIds.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        // Find listings for these parts
        return this.findListingsByPartIds(partIds, filters, pagination);
    }

    async bulkUpsert(
        listings: Array<Omit<Listing, 'id' | 'createdAt' | 'updatedAt'>>,
        maxBatchSize?: number
    ): Promise<Listing[]> {
        const batchSize = Math.min(maxBatchSize || 500, 1000);
        if (listings.length > 1000) {
            throw new Error(`Batch size exceeds maximum of 1000. Got ${listings.length}`);
        }

        const results: Listing[] = [];

        // Process in chunks
        for (let i = 0; i < listings.length; i += batchSize) {
            const chunk = listings.slice(i, i + batchSize);
            const chunkResults = await db.transaction(async (tx) => {
                const upserted: Listing[] = [];

                for (const listing of chunk) {
                    const upsertedListing = await this.upsert(listing);
                    upserted.push(upsertedListing);
                }

                return upserted;
            });

            results.push(...chunkResults);
        }

        return results;
    }

    /**
     * Helper to find listings by part IDs with filters
     */
    private async findListingsByPartIds(
        partIds: string[],
        filters?: ListingFilters,
        pagination?: PaginationParams
    ): Promise<Listing[] | PaginatedResult<Listing>> {
        if (partIds.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        let query = db
            .select({ listing: listings })
            .from(listings)
            .where(listings.partId.in(partIds));

        // Apply filters
        if (filters) {
            if (filters.condition) {
                query = query.where(and(eq(listings.condition, filters.condition)));
            }
            if (filters.availabilityStatus) {
                query = query.where(and(eq(listings.availabilityStatus, filters.availabilityStatus)));
            }
            if (filters.vendorId) {
                query = query.where(and(eq(listings.vendorId, filters.vendorId)));
            }
            if (filters.minPriceMinor !== undefined) {
                query = query.where(and(gte(listings.priceMinorMin, filters.minPriceMinor)));
            }
            if (filters.maxPriceMinor !== undefined) {
                query = query.where(and(lte(listings.priceMinorMin, filters.maxPriceMinor)));
            }
            if (filters.currency) {
                query = query.where(and(eq(listings.currency, filters.currency)));
            }
        }

        const rows = await query.limit(limit + 1).offset(offset);
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const listingIds = pageRows.map((row) => row.listing.id);

        if (listingIds.length === 0) {
            const items: Listing[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        const items = await this.fetchListingsWithRelations(listingIds);

        if (!pagination) return items;
        return createPaginatedResult(items, pagination, hasMore);
    }

    /**
     * Helper to fetch a single listing with relations
     */
    private async fetchListingWithRelations(listingId: string): Promise<Listing | null> {
        const listingRows = await db
            .select()
            .from(listings)
            .where(eq(listings.id, listingId))
            .limit(1);

        if (listingRows.length === 0) {
            return null;
        }

        const listingIds = [listingId];
        const results = await this.fetchListingsWithRelations(listingIds);
        return results[0] || null;
    }

    /**
     * Helper to fetch multiple listings with relations (vendor, part, warehouseLocation)
     */
    private async fetchListingsWithRelations(listingIds: string[]): Promise<Listing[]> {
        if (listingIds.length === 0) {
            return [];
        }

        // Fetch listings
        const listingRows = await db
            .select()
            .from(listings)
            .where(listings.id.in(listingIds));

        const vendorIds = [...new Set(listingRows.map((l) => l.vendorId))];
        const partIds = [...new Set(listingRows.map((l) => l.partId))];
        const warehouseLocationIds = listingRows
            .map((l) => l.warehouseLocationId)
            .filter((id): id is string => id !== null);

        // Fetch vendors
        const vendorRows = await db
            .select()
            .from(vendors)
            .where(vendors.id.in(vendorIds));

        // Fetch parts (simplified - would need full part repository for identifiers/dimensions)
        const partRows = await db
            .select()
            .from(parts)
            .where(parts.id.in(partIds));

        // Fetch warehouse locations
        const warehouseLocationRows =
            warehouseLocationIds.length > 0
                ? await db
                      .select()
                      .from(warehouseLocations)
                      .where(warehouseLocations.id.in(warehouseLocationIds))
                : [];

        // Build maps for quick lookup
        const vendorsMap = new Map(vendorRows.map((v) => [v.id, v]));
        const partsMap = new Map(partRows.map((p) => [p.id, p]));
        const warehouseLocationsMap = new Map(
            warehouseLocationRows.map((wl) => [wl.id, wl])
        );

        // Build aggregate data and convert to domain
        // Note: This is simplified - in production, you'd want to use the full PartRepository
        // to get parts with identifiers and dimensions
        return listingRows.map((listing) => {
            const vendor = vendorsMap.get(listing.vendorId);
            const part = partsMap.get(listing.partId);
            const warehouseLocation = listing.warehouseLocationId
                ? warehouseLocationsMap.get(listing.warehouseLocationId) || null
                : null;

            if (!vendor || !part) {
                throw new Error(`Missing vendor or part for listing ${listing.id}`);
            }

            // Convert to domain objects (simplified)
            const vendorDomain = {
                name: vendor.name,
                vendorType: vendor.vendorType as any,
                integrationType: vendor.integrationType as any,
                apiEndpoint: vendor.apiEndpoint ?? undefined,
                warehouseLocations: [],
                averageProcessingTimeHours: vendor.averageProcessingTimeHours ?? undefined,
                reliabilityScore:
                    vendor.reliabilityScore !== null ? Number(vendor.reliabilityScore) : undefined,
                cancellationRate:
                    vendor.cancellationRate !== null ? Number(vendor.cancellationRate) : undefined,
                requiresManualOrdering: vendor.requiresManualOrdering ?? undefined,
                createdAt: vendor.createdAt.toISOString(),
                updatedAt: vendor.updatedAt.toISOString(),
                id: vendor.id,
            } as any;

            const partDomain = {
                name: part.name,
                category: part.category as any,
                position: (part.position as any) ?? undefined,
                description: part.description ?? undefined,
                weightGrams: part.weightGrams ?? undefined,
                dimensions: undefined,
                partIdentifiers: [],
                isDiscontinued: part.isDiscontinued ?? undefined,
                createdAt: part.createdAt,
                updatedAt: part.updatedAt,
                id: part.id,
            } as any;

            const warehouseLocationDomain = warehouseLocation
                ? {
                      country: warehouseLocation.country,
                      stateOrProvince: warehouseLocation.stateOrProvince ?? undefined,
                      city: warehouseLocation.city ?? undefined,
                      postalCode: warehouseLocation.postalCode ?? undefined,
                      id: warehouseLocation.id,
                  }
                : null;

            const aggregateData: ListingAggregateData = {
                listing,
                vendor: vendorDomain,
                part: partDomain,
                warehouseLocation: warehouseLocationDomain,
            };

            return toDomainListing(aggregateData);
        });
    }
}
