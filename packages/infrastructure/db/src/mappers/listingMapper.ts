import type Listing from '@domain/listing/listing';
import type Vendor from '@domain/vendor/vendor';
import type Part from '@domain/part/part';
import type WarehouseLocation from '@domain/warehouseLocation/warehouseLocation';
import type { listings } from '../schema';

type ListingRow = typeof listings.$inferSelect;
type ListingInsert = typeof listings.$inferInsert;

/**
 * Aggregate listing data with related entities
 */
export interface ListingAggregateData {
    listing: ListingRow;
    vendor: Vendor;
    part: Part;
    warehouseLocation?: WarehouseLocation | null;
}

/**
 * Convert aggregated listing data to domain Listing
 * Note: Images are handled separately via ListingImageRepository
 */
export function toDomainListing(data: ListingAggregateData): Listing {
    const { listing, vendor, part, warehouseLocation } = data;

    return {
        id: listing.id,
        vendor,
        part,
        vendorListingExternalId: listing.vendorListingExternalId ?? undefined,
        sourceUrl: listing.sourceUrl ?? undefined,
        condition: listing.condition,
        description: listing.description ?? undefined,
        images: undefined, // Handled separately by ListingImageRepository
        quantityAvailable: listing.quantityAvailable ?? undefined,
        availabilityStatus: listing.availabilityStatus,
        priceMinorMin: listing.priceMinorMin,
        priceMinorMax: listing.priceMinorMax ?? undefined,
        currency: listing.currency,
        warehouseLocation: warehouseLocation ?? undefined,
        estimatedShipTimeHours: listing.estimatedShipTimeHours ?? undefined,
        estimatedDeliveryDate: listing.estimatedDeliveryDate ?? undefined,
        source: listing.source,
        lastVerifiedAt: listing.lastVerifiedAt,
        confidenceScore:
            listing.confidenceScore !== null ? Number(listing.confidenceScore) : undefined,
        isActive: listing.isActive,
        createdAt: listing.createdAt,
        updatedAt: listing.updatedAt,
    };
}

/**
 * Convert domain Listing to database insert format
 * Extracts IDs from nested vendor, part, and warehouseLocation objects
 */
export function toDbListingInsert(
    listing: Omit<Listing, 'id' | 'createdAt' | 'updatedAt' | 'images'>
): ListingInsert {
    return {
        vendorId: listing.vendor.id,
        partId: listing.part.id,
        vendorListingExternalId: listing.vendorListingExternalId ?? null,
        sourceUrl: listing.sourceUrl ?? null,
        condition: listing.condition,
        description: listing.description ?? null,
        quantityAvailable: listing.quantityAvailable ?? null,
        availabilityStatus: listing.availabilityStatus,
        priceMinorMin: listing.priceMinorMin,
        priceMinorMax: listing.priceMinorMax ?? null,
        currency: listing.currency,
        warehouseLocationId: listing.warehouseLocation?.id ?? null,
        estimatedShipTimeHours: listing.estimatedShipTimeHours ?? null,
        estimatedDeliveryDate: listing.estimatedDeliveryDate ?? null,
        source: listing.source,
        lastVerifiedAt: listing.lastVerifiedAt,
        confidenceScore: listing.confidenceScore ?? null,
        isActive: listing.isActive,
    };
}
