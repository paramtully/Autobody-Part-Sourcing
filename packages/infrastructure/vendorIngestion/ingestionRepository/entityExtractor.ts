/**
 * EntityExtractor — pure, stateless functions that project a CleanedDTO
 * into the shapes expected by each domain repository.
 *
 * No database access, no side effects. Easily unit-testable.
 *
 * These projections serve as the "DTO → domain mapping" layer that the
 * IngestionPersistenceService consumes before calling repository methods.
 */

import type { CleanedDTO } from '../cleaning/cleanedDTO';
import type WarehouseLocation from '@domain/warehouseLocation/warehouseLocation';
import type { Fitment, FitmentConstraint } from '@domain/fitment/fitment';
import type { InterchangeSystem } from '@domain/interchange/interchange';
import type ListingImage from '@domain/listing/listingImage';
import type Listing from '@domain/listing/listing';
import type Part from '@domain/part/part';
import type Vendor from '@domain/vendor/vendor';
import type { PartCategory } from '@domain/part/partCategory';
import type { PartPosition } from '@domain/part/partPosition';
import type { PartCondition } from '@domain/listing/partCondition';
import type { AvailabilityStatus } from '@domain/listing/availabilityStatus';
import type { Currency } from '@domain/listing/currency';
import type { DataSourceType } from '@domain/listing/dataSourceType';

// ─── Extracted shapes ────────────────────────────────────────────────

/**
 * Part metadata + identifier candidates extracted from the DTO.
 * Used to resolve or create a Part in the database.
 */
export interface ExtractedPartCandidate {
  /** Part number strings to search against the DB. */
  readonly partNumberCandidates: string[];

  /** Metadata to create a new Part if none of the candidates match. */
  readonly metadata: {
    readonly name: string;
    readonly category: PartCategory;
    readonly position?: PartPosition;
    readonly description?: string;
  } | null;
}

/**
 * Interchange info extracted from the DTO.
 */
export interface ExtractedInterchange {
  readonly system: string;
  readonly code: string;
}

// ─── Extraction functions ────────────────────────────────────────────

/**
 * Extract warehouse location fields from the DTO.
 * Returns null if the DTO has no warehouse location data.
 */
export function extractWarehouseLocation(dto: CleanedDTO): WarehouseLocation | null {
  if (!dto.warehouseLocation) return null;

  return {
    country: dto.warehouseLocation.country,
    stateOrProvince: dto.warehouseLocation.stateOrProvince,
    city: dto.warehouseLocation.city,
    postalCode: dto.warehouseLocation.postalCode,
  };
}

/**
 * Extract part resolution candidates and creation metadata from the DTO.
 */
export function extractPartCandidate(dto: CleanedDTO): ExtractedPartCandidate {
  return {
    partNumberCandidates: dto.normalizedPartNumberCandidates,
    metadata: dto.partMetadata
      ? {
          name: dto.partMetadata.name,
          category: dto.partMetadata.category,
          position: dto.partMetadata.position,
          description: dto.partMetadata.description,
        }
      : null,
  };
}

/**
 * Extract fitment fields from the DTO.
 * Returns null if the DTO has no fitment data or lacks required fields.
 *
 * The domain Fitment requires `make`, `model`, and `yearFrom`.
 * If any of these are missing in the DTO, we return null (no fitment to upsert).
 */
export function extractFitment(dto: CleanedDTO): Fitment | null {
  const f = dto.fitment;
  if (!f || !f.make || !f.model || f.yearFrom == null) return null;

  return {
    make: f.make,
    model: f.model,
    yearFrom: f.yearFrom,
    yearTo: f.yearTo,
    trims: f.trims,
    constraints: f.constraints?.filter(isFitmentConstraint),
    engine: f.engine,
  };
}

/**
 * Extract interchange fields from the DTO.
 * Returns null if system or code is missing.
 */
export function extractInterchange(dto: CleanedDTO): ExtractedInterchange | null {
  const ic = dto.interchange;
  if (!ic || !ic.system || !ic.code) return null;

  return {
    system: ic.system,
    code: ic.code,
  };
}

/**
 * Extract the listing-level fields from the DTO, combined with
 * resolved entities (vendor, part, warehouseLocation) to produce
 * the shape that ListingRepository.upsert() expects.
 */
export function extractListingFields(
  dto: CleanedDTO,
  vendor: Vendor,
  part: Part,
  warehouseLocation?: WarehouseLocation,
): Omit<Listing, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    vendor,
    part,
    vendorListingExternalId: dto.vendorListingExternalId,
    sourceUrl: dto.sourceUrl,
    condition: dto.condition as PartCondition,
    description: dto.description,
    quantityAvailable: dto.quantityAvailable,
    availabilityStatus: dto.availabilityStatus as AvailabilityStatus,
    priceMinorMin: dto.priceMinorMin,
    priceMinorMax: dto.priceMinorMax,
    currency: dto.currency as Currency,
    warehouseLocation,
    estimatedShipTimeHours: dto.estimatedShipTimeHours,
    estimatedDeliveryDate: dto.estimatedDeliveryDate
      ? new Date(dto.estimatedDeliveryDate)
      : undefined,
    source: dto.dataSource as DataSourceType,
    lastVerifiedAt: new Date(dto.ingestedAt),
    confidenceScore: dto.confidenceScore,
    isActive: dto.isActive,
  };
}

/**
 * Extract listing images from the DTO.
 * Returns an empty array if no images are present.
 */
export function extractListingImages(dto: CleanedDTO): ListingImage[] {
  if (!dto.images || dto.images.length === 0) return [];

  return dto.images.map((img) => ({
    url: img.url,
    type: normalizeImageType(img.imageType),
    source: img.source,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Narrow vendor-supplied image type strings to the domain enum values.
 * Unknown types fall through as undefined.
 */
function normalizeImageType(
  raw?: string,
): 'PRIMARY' | 'ANGLE' | 'DAMAGE' | 'STOCK' | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (
    upper === 'PRIMARY' ||
    upper === 'ANGLE' ||
    upper === 'DAMAGE' ||
    upper === 'STOCK'
  ) {
    return upper as 'PRIMARY' | 'ANGLE' | 'DAMAGE' | 'STOCK';
  }
  return undefined;
}

/**
 * Type guard: is the value a valid FitmentConstraint enum member?
 * Filters out vendor-specific string values that aren't in our enum.
 */
function isFitmentConstraint(value: FitmentConstraint | string): value is FitmentConstraint {
  // Import-free check: FitmentConstraint values are all UPPER_SNAKE strings
  // defined in the enum. We compare against the known set.
  const known = new Set<string>([
    'WITH_RADAR', 'WITHOUT_RADAR',
    'WITH_PARKING_SENSORS', 'WITHOUT_PARKING_SENSORS',
    'WITH_CAMERA', 'WITHOUT_CAMERA',
    'LED', 'HALOGEN', 'HID', 'ADAPTIVE',
    'SUNROOF', 'NO_SUNROOF',
    'AWD', 'FWD', 'RWD',
  ]);
  return known.has(value);
}
