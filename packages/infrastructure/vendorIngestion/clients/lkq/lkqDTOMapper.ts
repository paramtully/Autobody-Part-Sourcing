/**
 * LKQ-specific DTOMapper.
 *
 * Extends DefaultDTOMapper to override only what is genuinely
 * LKQ-specific: part grade → condition mapping and availability
 * inference with low-stock thresholds.
 *
 * Source vehicle provenance fields (vehicleVin, mileage, damageType)
 * are handled by DefaultDTOMapper via the base schema — no override
 * needed here. Any salvage vendor that sends those fields gets them
 * mapped automatically.
 */

import { DefaultDTOMapper } from '../../dto/dtoMapper';
import type { VendorListingRecord } from '../../inventorySchema';
import type { VendorInventoryDTO } from '../../dto/vendorInventoryDTO';
import { mapLkqCondition, mapLkqAvailability } from './lkqConditionMapper';
import type { LKQListingRecord } from './lkqResponseSchema';

export class LKQDTOMapper extends DefaultDTOMapper {
  /**
   * Override map() to apply LKQ-specific condition and availability logic.
   *
   * The base mapper handles all standard fields including source vehicle
   * provenance. We only override condition (partGrade → PartCondition)
   * and availability (LKQ-specific low-stock thresholds).
   */
  map(record: VendorListingRecord, vendorId: string, ingestedAt: string): VendorInventoryDTO {
    const base = super.map(record, vendorId, ingestedAt);

    // LKQ records are validated by lkqListingSchema which adds partGrade.
    // The base VendorListingRecord type doesn't know about it, but
    // passthrough preserves it at runtime.
    const lkqRecord = record as LKQListingRecord;

    return {
      ...base,
      condition: mapLkqCondition(
        lkqRecord.partGrade ?? undefined,
        record.condition ?? undefined,
      ) as VendorInventoryDTO['condition'],
      availabilityStatus: mapLkqAvailability(
        record.availability ?? undefined,
        record.quantity ?? undefined,
      ) as VendorInventoryDTO['availabilityStatus'],
    };
  }
}
