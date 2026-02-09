import type Listing from '@domain/listing/listing';
import { PartCondition } from '@domain/listing/partCondition';
import { AvailabilityStatus } from '@domain/listing/availabilityStatus';
import { Currency } from '@domain/listing/currency';
import type { Fitment } from '@domain/fitment/fitment';
import { PartCategory } from '@domain/part/partCategory';
import { InterchangeSystem } from '@domain/interchange/interchange';

/**
 * Filters for listing search operations.
 */
export interface ListingFilters {
    condition?: PartCondition;
    availabilityStatus?: AvailabilityStatus;
    vendorId?: string;
    minPriceMinor?: number;
    maxPriceMinor?: number;
    currency?: Currency;
}

/**
 * Repository interface for Listing domain operations.
 * Supports idempotent writes and does not leak database implementation details.
 */
export interface ListingRepository {
    /**
     * Upsert a listing (create or update).
     * Idempotent operation based on (vendorId, vendorListingExternalId) OR (vendorId, sourceUrl).
     * @param listing - Listing data (id, createdAt, updatedAt excluded)
     * @returns Created or updated listing with generated id
     */
    upsert(listing: Omit<Listing, 'id' | 'createdAt' | 'updatedAt'>): Promise<Listing>;

    /**
     * Find a listing by its unique identifier.
     * @param id - Listing UUID
     * @returns Listing if found, null otherwise
     */
    findById(id: string): Promise<Listing | null>;

    /**
     * Find listings for a specific part.
     * @param partId - Part UUID
     * @param filters - Optional filters to apply
     * @returns Array of matching listings (empty if none found)
     */
    findByPart(partId: string, filters?: ListingFilters): Promise<Listing[]>;

    /**
     * Find listings for a specific vendor and part combination.
     * @param vendorId - Vendor UUID
     * @param partId - Part UUID
     * @returns Array of matching listings (empty if none found)
     */
    findByVendorAndPart(vendorId: string, partId: string): Promise<Listing[]>;

    /**
     * Find listings by OEM part number.
     * Internally finds matching parts, then returns listings for those parts.
     * @param partNumber - OEM part number
     * @param manufacturer - Optional manufacturer filter
     * @param filters - Optional listing filters
     * @returns Array of matching listings (empty if none found)
     */
    findByOemPartNumber(
        partNumber: string,
        manufacturer?: string,
        filters?: ListingFilters
    ): Promise<Listing[]>;

    /**
     * Find listings by aftermarket part number.
     * Internally finds matching parts, then returns listings for those parts.
     * @param partNumber - Aftermarket part number
     * @param manufacturer - Optional manufacturer filter
     * @param filters - Optional listing filters
     * @returns Array of matching listings (empty if none found)
     */
    findByAftermarketPartNumber(
        partNumber: string,
        manufacturer?: string,
        filters?: ListingFilters
    ): Promise<Listing[]>;

    /**
     * Find listings by interchange code.
     * Internally finds matching parts, then returns listings for those parts.
     * @param system - Interchange system (e.g., HOLLANDER, OPTICAT)
     * @param code - Interchange code
     * @param filters - Optional listing filters
     * @returns Array of matching listings (empty if none found)
     */
    findByInterchangeCode(
        system: InterchangeSystem,
        code: string,
        filters?: ListingFilters
    ): Promise<Listing[]>;

    /**
     * Find listings by fitment (vehicle compatibility).
     * Service layer provides Fitment object (VIN decoding handled upstream).
     * Internally finds matching parts, then returns listings for those parts.
     * @param fitment - Vehicle fitment details
     * @param category - Optional part category filter (e.g., HEADLIGHT)
     * @param filters - Optional listing filters
     * @returns Array of matching listings (empty if none found)
     */
    findByFitment(
        fitment: Fitment,
        category?: PartCategory,
        filters?: ListingFilters
    ): Promise<Listing[]>;

    /**
     * Bulk upsert multiple listings.
     * Idempotent operation - each listing is upserted individually.
     * @param listings - Array of listing data (id, createdAt, updatedAt excluded)
     * @returns Array of created or updated listings with generated ids
     */
    bulkUpsert(listings: Array<Omit<Listing, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Listing[]>;
}
