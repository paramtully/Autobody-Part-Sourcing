import type { PartCondition } from '@domain/listing/partCondition';
import type { AvailabilityStatus } from '@domain/listing/availabilityStatus';
import type { Currency } from '@domain/listing/currency';
import type { DataSourceType } from '@domain/listing/dataSourceType';
import type { FitmentConstraint } from '@domain/fitment/fitment';
import type { PartCategory } from '@domain/part/partCategory';
import type { PartPosition } from '@domain/part/partPosition';

/**
 * Normalized, ingestion-level listing record derived from a single vendor inventory entry.
 * 
 * This DTO is designed to:
 * - Support idempotent ingestion
 * - Enable replay from raw payload storage
 * - Support payload fingerprinting and change detection
 * - Map cleanly into domain listing + inventory models
 * 
 * All fields are strictly typed (no `any`) and nullable-safe.
 */
export interface VendorInventoryDTO {
  /**
   * Identity & Deduplication
   */
  vendorId: string; // Internal UUID
  vendorListingExternalId?: string; // Vendor's own listing ID
  sourceUrl?: string; // Canonical URL for the listing
  normalizedPartNumberCandidates: string[]; // OEM, aftermarket, vendor-specific codes for part resolution

  /**
   * Payload Fingerprinting
   * Used for change detection to prevent unnecessary writes.
   */
  canonicalPayloadJson: string; // Normalized JSON string for hashing - excludes volatile fields
  payloadHash: string; // SHA-256 hash of canonicalPayloadJson
  vendorUpdatedAt?: string; // Raw vendor timestamp if available, ISO string

  /**
   * Listing Attributes
   */
  condition: PartCondition | 'UNKNOWN'; // Mapped to domain enum with fallback
  description?: string;
  quantityAvailable?: number;
  availabilityStatus: AvailabilityStatus | 'UNKNOWN'; // Mapped to domain enum with fallback
  isActive: boolean;

  /**
   * Pricing
   */
  priceMinorMin: number; // Normalized to minor units (e.g., cents for USD)
  priceMinorMax?: number;
  currency: Currency | string; // Validated to enum where possible, fallback to string
  originalPriceString?: string; // For debugging/audit

  /**
   * Logistics / Shipping
   */
  warehouseLocation?: {
    country: string;
    stateOrProvince?: string;
    city?: string;
    postalCode?: string;
    rawLocationText?: string; // Optional, if vendor only gives a free-text location
  };
  estimatedShipTimeHours?: number;
  estimatedDeliveryDate?: string; // ISO string; can be converted to Date later

  /**
   * Fitment Information (Optional)
   * Designed to map into the Fitment domain model and FitmentRepository methods.
   */
  fitment?: {
    make?: string;
    model?: string;
    yearFrom?: number;
    yearTo?: number;
    trims?: string[];
    constraints?: (FitmentConstraint | string)[]; // Mappable to domain constraints enum
    engine?: string;
    rawFitmentText?: string; // Optional free-text vendor fitment description
  };

  /**
   * Interchange Information (Optional)
   * Enough to:
   * - Upsert Interchange via (system, code)
   * - Upsert InterchangeMembership once a canonical part is resolved
   */
  interchange?: {
    system?: string; // e.g., 'HOLLANDER', 'OPTICAT', or vendor-specific system id
    code?: string;
    groupId?: string; // If vendor groups interchangeable parts
    rawInterchangeText?: string;
  };

  /**
   * Source Vehicle Provenance (Optional)
   * Populated automatically for any vendor that includes vehicleVin/mileage/damageType
   * in their response. Unique to salvage/recycled parts.
   */
  sourceVehicleVin?: string;   // 17-char NHTSA VIN of donor vehicle
  sourceMileage?: number;      // Odometer at time of salvage
  sourceDamageType?: string;   // e.g. 'FRONT', 'REAR', 'FLOOD', 'ROLLOVER'

  /**
   * Listing Images (Optional)
   * Structured so it can be mapped into ListingImage and saved via ListingImageRepository.saveListingImages
   */
  images?: Array<{
    url: string;
    imageType?: 'PRIMARY' | 'ANGLE' | 'DAMAGE' | 'STOCK' | string; // Allow vendor-specific values but prefer mapping to our enum
    source?: string; // e.g., 'VENDOR', CDN name, attribution
    sortOrder?: number;
  }>;

  /**
   * Timestamps / Data Quality
   */
  vendorLastUpdatedAt?: string; // Vendor's own last-updated timestamp (string/ISO)
  ingestedAt: string; // When we pulled this listing from vendor, ISO string
  confidenceScore?: number; // 0–1 if you compute one at ingestion-time

  /**
   * Part Metadata (Optional)
   * Provides enough information to create a Part when no existing Part
   * matches the normalizedPartNumberCandidates. Each vendor's DTOMapper
   * should populate this so the ingestion pipeline can create new parts.
   */
  partMetadata?: {
    name: string;
    category: PartCategory;
    position?: PartPosition;
    description?: string;
  };

  /**
   * Metadata
   */
  dataSource: DataSourceType; // Maps to domain DataSourceType
  rawVendorDataFragment?: unknown; // Small, bounded fragment for debugging (NOT the whole payload)
}

/**
 * Validation helper to ensure DTO has at least one identity field.
 */
export function hasValidIdentity(dto: VendorInventoryDTO): boolean {
  return !!(dto.vendorListingExternalId || dto.sourceUrl);
}

/**
 * Type guard to check if a value is a valid VendorInventoryDTO.
 * This is a basic check - full validation should use Zod schema.
 */
export function isValidVendorInventoryDTO(value: unknown): value is VendorInventoryDTO {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const dto = value as Partial<VendorInventoryDTO>;

  return (
    typeof dto.vendorId === 'string' &&
    typeof dto.canonicalPayloadJson === 'string' &&
    typeof dto.payloadHash === 'string' &&
    typeof dto.ingestedAt === 'string' &&
    typeof dto.condition === 'string' &&
    typeof dto.availabilityStatus === 'string' &&
    typeof dto.isActive === 'boolean' &&
    typeof dto.priceMinorMin === 'number' &&
    typeof dto.currency === 'string' &&
    typeof dto.dataSource === 'string' &&
    Array.isArray(dto.normalizedPartNumberCandidates) &&
    hasValidIdentity(dto as VendorInventoryDTO)
  );
}
