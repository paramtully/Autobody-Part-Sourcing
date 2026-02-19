/**
 * CleanedDTO type (System 5A output).
 *
 * A VendorInventoryDTO that has been through the DataCleaner:
 * - All string fields trimmed
 * - Enums normalized to domain values
 * - Dates parsed and validated
 * - Prices validated (positive, reasonable range)
 * - Year ranges validated (yearFrom <= yearTo)
 *
 * CleanedDTO is a branded type of VendorInventoryDTO. The brand
 * ensures that only DTOs that have been cleaned can be passed to
 * the DomainReconciler, enforcing the pipeline order at the type level.
 */

import type { VendorInventoryDTO } from '../dto/vendorInventoryDTO';

/**
 * Brand symbol for type-level enforcement.
 * A CleanedDTO has been validated and normalized.
 */
declare const cleanedBrand: unique symbol;

/**
 * A VendorInventoryDTO that has been cleaned and validated.
 *
 * The __cleaned brand property exists only at the type level
 * and has no runtime overhead. It prevents passing uncleaned DTOs
 * to functions that require cleaned input.
 */
export type CleanedDTO = VendorInventoryDTO & {
  readonly [cleanedBrand]: true;
};

/**
 * Cast a validated VendorInventoryDTO to CleanedDTO.
 * Should only be called by the DataCleaner after successful validation.
 *
 * @param dto - The validated and cleaned DTO
 * @returns The same DTO branded as CleanedDTO
 */
export function markAsCleaned(dto: VendorInventoryDTO): CleanedDTO {
  return dto as CleanedDTO;
}
