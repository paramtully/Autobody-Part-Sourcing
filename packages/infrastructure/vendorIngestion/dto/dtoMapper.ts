/**
 * DTOMapper (System 4)
 *
 * Maps validated Zod records (VendorListingRecord) to VendorInventoryDTO.
 *
 * This is the "translation layer" between the raw vendor schema
 * and the normalized DTO that the rest of the pipeline operates on.
 *
 * Design:
 * - DTOMapper interface allows vendor-specific mappers (LKQ grades, CCC quality tiers)
 * - DefaultDTOMapper handles the common case (generic vendor record)
 * - Computes canonicalPayloadJson and payloadHash using the existing canonicalizer
 * - Maps vendor condition/availability strings to domain enum values
 * - Never touches the database
 */

import type { VendorInventoryDTO } from './vendorInventoryDTO';
import type { VendorListingRecord } from '../inventorySchema';
import { canonicalizePayload, computePayloadHash } from '../changeDetection/canonicalizer';

/**
 * DTOMapper interface.
 *
 * Each vendor can have a custom mapper if their data format
 * requires special handling. Otherwise, DefaultDTOMapper works.
 */
export interface DTOMapper {
  /**
   * Map a validated vendor listing record to a VendorInventoryDTO.
   *
   * @param record - Validated vendor listing record (output of Zod parse)
   * @param vendorId - The vendor identifier
   * @param ingestedAt - ISO timestamp of when this record was fetched
   * @returns A fully populated VendorInventoryDTO
   */
  map(record: VendorListingRecord, vendorId: string, ingestedAt: string): VendorInventoryDTO;
}

/**
 * Condition string to PartCondition enum mapping.
 * Case-insensitive lookup.
 */
const CONDITION_MAP: Record<string, string> = {
  'NEW_OEM': 'NEW_OEM',
  'NEW OEM': 'NEW_OEM',
  'OEM': 'NEW_OEM',
  'NEW_AFTERMARKET': 'NEW_AFTERMARKET',
  'NEW AFTERMARKET': 'NEW_AFTERMARKET',
  'AFTERMARKET': 'NEW_AFTERMARKET',
  'RECYCLED': 'RECYCLED',
  'USED': 'RECYCLED',
  'SALVAGE': 'RECYCLED',
  'REMANUFACTURED': 'REMANUFACTURED',
  'REMAN': 'REMANUFACTURED',
  'REBUILT': 'REMANUFACTURED',
  'RECONDITIONED': 'RECONDITIONED',
  'REFURBISHED': 'RECONDITIONED',
};

/**
 * Availability string to AvailabilityStatus enum mapping.
 * Case-insensitive lookup.
 */
const AVAILABILITY_MAP: Record<string, string> = {
  'IN_STOCK': 'IN_STOCK',
  'IN STOCK': 'IN_STOCK',
  'AVAILABLE': 'IN_STOCK',
  'LOW_STOCK': 'LOW_STOCK',
  'LOW STOCK': 'LOW_STOCK',
  'LIMITED': 'LOW_STOCK',
  'BACKORDER': 'BACKORDER',
  'BACKORDERED': 'BACKORDER',
  'BACK ORDER': 'BACKORDER',
  'SPECIAL_ORDER': 'SPECIAL_ORDER',
  'SPECIAL ORDER': 'SPECIAL_ORDER',
};

/**
 * Default DTOMapper implementation.
 *
 * Maps common vendor record fields to VendorInventoryDTO.
 * Works for any vendor that follows the base vendorListingRecordSchema.
 * Override for vendor-specific field handling.
 */
export class DefaultDTOMapper implements DTOMapper {
  constructor(
    private readonly defaultDataSource: 'VENDOR_API' | 'SCRAPER' | 'CSV_UPLOAD' | 'MANUAL_ENTRY' = 'VENDOR_API'
  ) {}

  map(record: VendorListingRecord, vendorId: string, ingestedAt: string): VendorInventoryDTO {
    const canonicalPayloadJson = canonicalizePayload(record);
    const payloadHash = computePayloadHash(record);

    return {
      // Identity
      vendorId,
      vendorListingExternalId: this.extractExternalId(record),
      sourceUrl: record.sourceUrl ?? record.url ?? undefined,
      normalizedPartNumberCandidates: this.extractPartNumbers(record),

      // Payload fingerprinting
      canonicalPayloadJson,
      payloadHash,
      vendorUpdatedAt: record.updatedAt ?? undefined,

      // Listing attributes
      condition: this.mapCondition(record.condition),
      description: record.description ?? undefined,
      quantityAvailable: record.quantity ?? undefined,
      availabilityStatus: this.mapAvailability(record.availability, record.quantity),
      isActive: record.isActive ?? true,

      // Pricing
      priceMinorMin: this.toMinorUnits(record.price),
      priceMinorMax: record.priceMax != null ? this.toMinorUnits(record.priceMax) : undefined,
      currency: this.mapCurrency(record.currency) ?? 'USD',
      originalPriceString: record.price != null ? String(record.price) : undefined,

      // Logistics
      warehouseLocation: this.extractWarehouseLocation(record),
      estimatedShipTimeHours: record.estimatedShipTime ?? undefined,

      // Fitment
      fitment: this.extractFitment(record),

      // Interchange
      interchange: this.extractInterchange(record),

      // Source vehicle provenance
      ...this.extractSourceVehicle(record),

      // Images
      images: this.extractImages(record),

      // Timestamps
      vendorLastUpdatedAt: record.updatedAt ?? undefined,
      ingestedAt,
      confidenceScore: undefined,

      // Metadata
      dataSource: this.defaultDataSource as VendorInventoryDTO['dataSource'],
      rawVendorDataFragment: undefined,
    };
  }

  /**
   * Extract the external listing ID from the vendor record.
   * Prefers vendorListingId, falls back to listingId, then id.
   */
  protected extractExternalId(record: VendorListingRecord): string | undefined {
    return record.vendorListingId
      ?? record.listingId
      ?? record.id
      ?? undefined;
  }

  /**
   * Extract all available part number candidates.
   * Used for canonical part resolution downstream.
   */
  protected extractPartNumbers(record: VendorListingRecord): string[] {
    const candidates: string[] = [];
    if (record.oemPartNumber) candidates.push(record.oemPartNumber);
    if (record.partNumber && record.partNumber !== record.oemPartNumber) {
      candidates.push(record.partNumber);
    }
    if (record.aftermarketPartNumber) candidates.push(record.aftermarketPartNumber);
    return candidates;
  }

  /**
   * Map vendor condition string to domain PartCondition enum value.
   */
  protected mapCondition(condition?: string | null): VendorInventoryDTO['condition'] {
    if (!condition) return 'UNKNOWN';
    const normalized = condition.toUpperCase().trim();
    const mapped = CONDITION_MAP[normalized];
    return (mapped ?? 'UNKNOWN') as VendorInventoryDTO['condition'];
  }

  /**
   * Map vendor availability string to domain AvailabilityStatus enum value.
   */
  protected mapAvailability(
    availability?: string | null,
    quantity?: number | null
  ): VendorInventoryDTO['availabilityStatus'] {
    if (availability) {
      const normalized = availability.toUpperCase().trim();
      const mapped = AVAILABILITY_MAP[normalized];
      if (mapped) return mapped as VendorInventoryDTO['availabilityStatus'];
    }

    // Infer from quantity if availability string not recognized
    if (quantity != null) {
      if (quantity <= 0) return 'BACKORDER';
      if (quantity <= 2) return 'LOW_STOCK';
      return 'IN_STOCK';
    }

    return 'UNKNOWN';
  }

  /**
   * Convert price to minor units (cents for USD).
   * Returns 0 if price is null/undefined.
   */
  protected toMinorUnits(price?: number | null): number {
    if (price == null) return 0;
    return Math.round(price * 100);
  }

  /**
   * Map currency string to domain Currency enum value.
   */
  protected mapCurrency(currency?: string | null): string {
    if (!currency) return 'USD';
    return currency.toUpperCase().trim();
  }

  /**
   * Extract warehouse location from vendor record.
   */
  protected extractWarehouseLocation(record: VendorListingRecord): VendorInventoryDTO['warehouseLocation'] {
    if (!record.location && !record.warehouse && !record.state && !record.postalCode && !record.country) {
      return undefined;
    }

    return {
      country: record.country ?? 'US',
      stateOrProvince: record.state ?? undefined,
      city: record.city ?? undefined,
      postalCode: record.postalCode ?? undefined,
      rawLocationText: record.location ?? record.warehouse ?? undefined,
    };
  }

  /**
   * Extract fitment information from vendor record.
   */
  protected extractFitment(record: VendorListingRecord): VendorInventoryDTO['fitment'] {
    if (!record.make && !record.model && !record.yearFrom && !record.yearTo) {
      return undefined;
    }

    return {
      make: record.make ?? undefined,
      model: record.model ?? undefined,
      yearFrom: record.yearFrom ?? undefined,
      yearTo: record.yearTo ?? undefined,
      trims: record.trim ? [record.trim] : undefined,
      rawFitmentText: undefined,
    };
  }

  /**
   * Extract interchange information from vendor record.
   */
  protected extractInterchange(record: VendorListingRecord): VendorInventoryDTO['interchange'] {
    if (!record.interchangeSystem && !record.interchangeCode) {
      return undefined;
    }

    return {
      system: record.interchangeSystem ?? undefined,
      code: record.interchangeCode ?? undefined,
    };
  }

  /**
   * Extract source vehicle provenance from vendor record.
   * Populated by salvage/recycler vendors that include donor vehicle info.
   */
  protected extractSourceVehicle(record: VendorListingRecord): {
    sourceVehicleVin?: string;
    sourceMileage?: number;
    sourceDamageType?: string;
  } {
    return {
      sourceVehicleVin: record.vehicleVin ?? undefined,
      sourceMileage: record.mileage ?? undefined,
      sourceDamageType: record.damageType ?? undefined,
    };
  }

  /**
   * Extract images from vendor record.
   */
  protected extractImages(record: VendorListingRecord): VendorInventoryDTO['images'] {
    if (!record.images || record.images.length === 0) {
      return undefined;
    }

    return record.images.map((img, i) => ({
      url: img.url,
      imageType: img.type ?? (i === 0 ? 'PRIMARY' : undefined),
      sortOrder: i,
    }));
  }
}
