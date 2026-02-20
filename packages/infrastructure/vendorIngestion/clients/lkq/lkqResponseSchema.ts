/**
 * LKQ-specific Zod schemas for API response validation.
 *
 * Extends the base vendorListingRecordSchema with LKQ-specific fields
 * such as part grading, yard information, and warranty details.
 *
 * Note: vehicleVin, mileage, and damageType are defined in the base
 * vendorListingRecordSchema (inventorySchema.ts) and inherited here
 * automatically — they are not LKQ-specific.
 *
 * Uses .passthrough() for schema drift tolerance -- LKQ may add fields
 * at any time, and we want to capture them without breaking validation.
 */

import { z } from 'zod';
import { vendorListingRecordSchema } from '../../inventorySchema';

/**
 * LKQ-specific listing record schema.
 *
 * Extends base schema with fields specific to LKQ's recycled parts inventory:
 * - Part grading (A/B/C quality scale)
 * - Salvage yard identification
 * - Warranty information
 * - Hollander interchange codes
 *
 * Source vehicle provenance (vehicleVin, mileage, damageType) is inherited
 * from the base schema — any vendor can provide these fields.
 */
export const lkqListingSchema = vendorListingRecordSchema
  .innerType()  // unwrap the .refine() to extend
  .extend({
    /** LKQ internal stock number (e.g., "78432-A"). */
    stockNumber: z.string().optional(),

    /** Salvage yard identifier (e.g., "LKQ-DFW-03"). */
    yardId: z.string().optional(),

    /** Salvage yard name. */
    yardName: z.string().optional(),

    /**
     * LKQ part quality grade.
     * - 'A': Excellent condition, minimal wear
     * - 'B': Good condition, minor cosmetic imperfections
     * - 'C': Functional, visible cosmetic damage
     * - 'REMAN': Remanufactured to OEM spec
     */
    partGrade: z.string().optional(),

    /** Hollander interchange number for part cross-referencing. */
    hollanderNumber: z.string().optional(),

    /** Date the part was pulled from the vehicle (ISO string). */
    pullDate: z.string().optional(),

    /** Warranty period in days. */
    warrantyDays: z.coerce.number().int().nonnegative().optional(),
  })
  .passthrough()
  .refine(
    (data) => {
      return !!(data.id || data.vendorListingId || data.listingId || data.url || data.sourceUrl || data.stockNumber);
    },
    {
      message: 'At least one identity field (id, vendorListingId, listingId, url, sourceUrl, or stockNumber) must be provided',
      path: ['id'],
    }
  );

/**
 * LKQ paginated inventory response schema.
 */
export const lkqPageResponseSchema = z.object({
  /** Array of listing records in this page. */
  listings: z.array(lkqListingSchema),

  /** Cursor for the next page. Absent when no more pages. */
  nextCursor: z.string().optional(),

  /** Whether more pages are available. */
  hasMore: z.boolean(),

  /** Total number of listings matching the query (approximate). */
  totalAvailable: z.number().optional(),

  /** LKQ-assigned request ID for support correlation. */
  requestId: z.string().optional(),
}).passthrough();

/**
 * Type inference from schemas.
 */
export type LKQListingRecord = z.infer<typeof lkqListingSchema>;
export type LKQPageResponse = z.infer<typeof lkqPageResponseSchema>;
