/**
 * DataCleaner (System 5A)
 *
 * Stateless transformation and validation of VendorInventoryDTO.
 * Cleans, normalizes, and validates DTOs before they reach the
 * DomainReconciler (System 5B).
 *
 * Design principles:
 * - Pure functions: no database, no side effects, no state
 * - Deterministic: same input always produces same output
 * - Independent: can be tested in complete isolation
 * - Separable: if removed, the reconciler can work with uncleaned DTOs
 *
 * Operations:
 * 1. Trim all string fields
 * 2. Normalize condition to PartCondition enum
 * 3. Normalize availability to AvailabilityStatus enum
 * 4. Validate price (positive, reasonable range)
 * 5. Validate year ranges (yearFrom <= yearTo, not in future)
 * 6. Validate identity (at least one ID field)
 * 7. Validate part numbers (at least one candidate)
 * 8. Produce CleanedDTO or ValidationFailure
 */

import type { VendorInventoryDTO } from '../dto/vendorInventoryDTO';
import type { CleanedDTO } from './cleanedDTO';
import { markAsCleaned } from './cleanedDTO';
import type { ValidationResult, ValidationError } from './validationResult';

/**
 * DataCleaner interface.
 *
 * Stateless: no dependencies, no database.
 * The orchestrator calls clean() for each DTO.
 */
export interface DataCleaner {
  /**
   * Clean and validate a single VendorInventoryDTO.
   *
   * @param dto - The DTO to clean
   * @returns ValidationResult with CleanedDTO on success or errors on failure
   */
  clean(dto: VendorInventoryDTO): ValidationResult<CleanedDTO>;
}

/** Maximum reasonable price in minor units ($1M = 100_000_000 cents). */
const MAX_REASONABLE_PRICE_MINOR = 100_000_000;

/** Current year for year range validation. */
const CURRENT_YEAR = new Date().getFullYear();

/** Maximum future year for fitment (next model year). */
const MAX_FUTURE_YEAR = CURRENT_YEAR + 2;

/** Minimum valid year for automotive parts. */
const MIN_VALID_YEAR = 1900;

/**
 * Default DataCleaner implementation.
 *
 * Applies all standard cleaning rules. Can be extended for
 * vendor-specific cleaning by subclassing.
 */
export class DefaultDataCleaner implements DataCleaner {
  clean(dto: VendorInventoryDTO): ValidationResult<CleanedDTO> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Create a mutable copy for cleaning
    const cleaned = { ...dto };

    // 1. Trim strings
    this.trimStrings(cleaned);

    // 2. Validate identity
    this.validateIdentity(cleaned, errors);

    // 3. Validate part numbers
    this.validatePartNumbers(cleaned, warnings);

    // 4. Validate and normalize price
    this.validatePrice(cleaned, errors, warnings);

    // 5. Validate condition
    this.validateCondition(cleaned, warnings);

    // 6. Validate availability
    this.validateAvailability(cleaned, warnings);

    // 7. Validate year range
    this.validateYearRange(cleaned, errors, warnings);

    // 8. Validate timestamps
    this.validateTimestamps(cleaned, warnings);

    // 9. Validate images
    this.validateImages(cleaned, warnings);

    // Return result
    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        warnings,
        vendorId: dto.vendorId,
        vendorListingExternalId: dto.vendorListingExternalId,
      };
    }

    return {
      valid: true,
      data: markAsCleaned(cleaned),
      warnings,
    };
  }

  /**
   * Trim all string fields in the DTO.
   */
  protected trimStrings(dto: VendorInventoryDTO): void {
    if (dto.vendorListingExternalId) {
      dto.vendorListingExternalId = dto.vendorListingExternalId.trim();
    }
    if (dto.sourceUrl) {
      dto.sourceUrl = dto.sourceUrl.trim();
    }
    if (dto.description) {
      dto.description = dto.description.trim();
    }
    if (dto.originalPriceString) {
      dto.originalPriceString = dto.originalPriceString.trim();
    }
    dto.normalizedPartNumberCandidates = dto.normalizedPartNumberCandidates.map(p => p.trim()).filter(Boolean);
  }

  /**
   * Validate that the DTO has at least one identity field.
   */
  protected validateIdentity(dto: VendorInventoryDTO, errors: ValidationError[]): void {
    if (!dto.vendorListingExternalId && !dto.sourceUrl) {
      errors.push({
        field: 'vendorListingExternalId',
        code: 'MISSING_IDENTITY',
        message: 'DTO must have at least one identity field (vendorListingExternalId or sourceUrl)',
      });
    }
  }

  /**
   * Validate part number candidates.
   */
  protected validatePartNumbers(dto: VendorInventoryDTO, warnings: ValidationError[]): void {
    if (dto.normalizedPartNumberCandidates.length === 0) {
      warnings.push({
        field: 'normalizedPartNumberCandidates',
        code: 'MISSING_PART_NUMBER',
        message: 'No part number candidates available. Part resolution will be limited.',
      });
    }
  }

  /**
   * Validate and normalize price.
   */
  protected validatePrice(
    dto: VendorInventoryDTO,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    if (dto.priceMinorMin < 0) {
      errors.push({
        field: 'priceMinorMin',
        code: 'NEGATIVE_PRICE',
        message: `Price cannot be negative: ${dto.priceMinorMin}`,
        receivedValue: dto.priceMinorMin,
      });
    }

    if (dto.priceMinorMin === 0) {
      warnings.push({
        field: 'priceMinorMin',
        code: 'ZERO_PRICE',
        message: 'Price is zero. This may indicate "Call for price" or missing data.',
      });
    }

    if (dto.priceMinorMin > MAX_REASONABLE_PRICE_MINOR) {
      warnings.push({
        field: 'priceMinorMin',
        code: 'OUT_OF_RANGE',
        message: `Price ${dto.priceMinorMin} exceeds reasonable maximum ${MAX_REASONABLE_PRICE_MINOR}. Verify correctness.`,
        receivedValue: dto.priceMinorMin,
      });
    }

    if (dto.priceMinorMax != null && dto.priceMinorMax < dto.priceMinorMin) {
      warnings.push({
        field: 'priceMinorMax',
        code: 'OUT_OF_RANGE',
        message: `Max price ${dto.priceMinorMax} is less than min price ${dto.priceMinorMin}. Swapping.`,
        receivedValue: dto.priceMinorMax,
      });
      // Auto-correct: swap min and max
      const temp = dto.priceMinorMin;
      dto.priceMinorMin = dto.priceMinorMax;
      dto.priceMinorMax = temp;
    }
  }

  /**
   * Validate condition field.
   */
  protected validateCondition(dto: VendorInventoryDTO, warnings: ValidationError[]): void {
    if (dto.condition === 'UNKNOWN') {
      warnings.push({
        field: 'condition',
        code: 'UNKNOWN_CONDITION',
        message: 'Part condition could not be determined from vendor data.',
      });
    }
  }

  /**
   * Validate availability status.
   */
  protected validateAvailability(dto: VendorInventoryDTO, warnings: ValidationError[]): void {
    if (dto.availabilityStatus === 'UNKNOWN') {
      warnings.push({
        field: 'availabilityStatus',
        code: 'UNKNOWN_AVAILABILITY',
        message: 'Availability status could not be determined from vendor data.',
      });
    }
  }

  /**
   * Validate fitment year range.
   */
  protected validateYearRange(
    dto: VendorInventoryDTO,
    errors: ValidationError[],
    warnings: ValidationError[]
  ): void {
    if (!dto.fitment) return;

    const { yearFrom, yearTo } = dto.fitment;

    if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
      warnings.push({
        field: 'fitment.yearFrom',
        code: 'INVALID_YEAR_RANGE',
        message: `yearFrom (${yearFrom}) > yearTo (${yearTo}). Swapping.`,
      });
      // Auto-correct: swap
      dto.fitment = { ...dto.fitment, yearFrom: yearTo, yearTo: yearFrom };
    }

    if (yearFrom != null && (yearFrom < MIN_VALID_YEAR || yearFrom > MAX_FUTURE_YEAR)) {
      errors.push({
        field: 'fitment.yearFrom',
        code: 'OUT_OF_RANGE',
        message: `yearFrom (${yearFrom}) is outside valid range [${MIN_VALID_YEAR}, ${MAX_FUTURE_YEAR}].`,
        receivedValue: yearFrom,
      });
    }

    if (yearTo != null && (yearTo < MIN_VALID_YEAR || yearTo > MAX_FUTURE_YEAR)) {
      errors.push({
        field: 'fitment.yearTo',
        code: 'OUT_OF_RANGE',
        message: `yearTo (${yearTo}) is outside valid range [${MIN_VALID_YEAR}, ${MAX_FUTURE_YEAR}].`,
        receivedValue: yearTo,
      });
    }
  }

  /**
   * Validate timestamps.
   */
  protected validateTimestamps(dto: VendorInventoryDTO, warnings: ValidationError[]): void {
    if (dto.vendorUpdatedAt) {
      const date = new Date(dto.vendorUpdatedAt);
      if (isNaN(date.getTime())) {
        warnings.push({
          field: 'vendorUpdatedAt',
          code: 'INVALID_FORMAT',
          message: `Could not parse vendorUpdatedAt: "${dto.vendorUpdatedAt}"`,
          receivedValue: dto.vendorUpdatedAt,
        });
        dto.vendorUpdatedAt = undefined;
      }
    }
  }

  /**
   * Validate image URLs.
   */
  protected validateImages(dto: VendorInventoryDTO, warnings: ValidationError[]): void {
    if (!dto.images) return;

    dto.images = dto.images.filter((img) => {
      try {
        new URL(img.url);
        return true;
      } catch {
        warnings.push({
          field: 'images',
          code: 'INVALID_URL',
          message: `Invalid image URL: "${img.url}". Removing from list.`,
          receivedValue: img.url,
        });
        return false;
      }
    });
  }
}
