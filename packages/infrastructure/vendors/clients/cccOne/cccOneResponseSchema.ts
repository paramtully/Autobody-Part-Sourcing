/**
 * CCC One-specific Zod schemas for API response validation.
 *
 * CCC One is an insurance estimating platform that returns part alternatives
 * for a given OEM part number. Unlike inventory feeds, CCC One responses
 * contain reference data (OEM + aftermarket + recycled alternatives)
 * with estimated pricing and labor information.
 *
 * Key differences from inventory vendors:
 * - Prices are estimates, not real-time
 * - Data can be stale (up to 1 week, indicated by X-Cache-Age)
 * - Includes labor hours and paint requirements
 * - Includes part certifications (CAPA, NSF)
 */

import { z } from 'zod';
import { vendorListingRecordSchema } from '../../inventorySchema';

/**
 * CCC One part alternative schema.
 *
 * Extends base schema with estimating platform-specific fields:
 * - Part quality grade (OEM, OEM_SURPLUS, AFTERMARKET, RECYCLED, REMANUFACTURED)
 * - Labor hours estimate
 * - Paint requirements
 * - Industry certifications
 * - Estimate source and confidence
 */
export const cccPartAlternativeSchema = vendorListingRecordSchema
  .innerType()  // unwrap .refine() to extend
  .extend({
    /**
     * CCC part quality classification.
     * Drives condition mapping and confidence scoring.
     */
    partQuality: z.enum([
      'OEM',
      'OEM_SURPLUS',
      'AFTERMARKET',
      'RECYCLED',
      'REMANUFACTURED',
    ]).optional(),

    /** Estimated labor hours for installation. */
    laborHours: z.coerce.number().nonnegative().optional(),

    /** Whether the part requires painting after installation. */
    paintRequired: z.boolean().optional(),

    /**
     * Industry certifications for this part.
     * Common values: 'CAPA' (Certified Automotive Parts Association),
     * 'NSF' (NSF International), 'TAPA' (Taiwan Automotive Parts)
     */
    certifications: z.array(z.string()).optional(),

    /** The OEM part number this is an alternative for. */
    alternativeFor: z.string().optional(),

    /**
     * Source of the estimate data.
     * 'CCC_DATABASE' = CCC's internal reference data
     * 'VENDOR_FEED' = Data from vendor/distributor feed
     * 'MANUAL_ENTRY' = Manually entered estimate
     */
    estimateSource: z.string().optional(),

    /** Cache age from X-Cache-Age header (ISO 8601 duration, e.g., "PT4H"). */
    cacheAge: z.string().optional(),

    /** CCC's confidence in the estimate accuracy (0-1 scale). */
    estimateConfidence: z.coerce.number().min(0).max(1).optional(),
  })
  .passthrough()
  .refine(
    (data) => {
      return !!(data.id || data.vendorListingId || data.listingId || data.partNumber || data.oemPartNumber);
    },
    {
      message: 'At least one identity field must be provided for CCC alternative',
      path: ['id'],
    }
  );

/**
 * Labor information block in CCC response.
 */
export const cccLaborInfoSchema = z.object({
  hours: z.number().nonnegative().optional(),
  rate: z.number().nonnegative().optional(),
  operation: z.string().optional(),
}).passthrough();

/**
 * CCC One parts lookup response schema.
 *
 * Returned by the /parts/lookup endpoint for a single OEM part number.
 * Contains all available alternatives across quality tiers.
 */
export const cccPartsLookupResponseSchema = z.object({
  /** The OEM part number that was queried. */
  requestedPartNumber: z.string(),

  /** Array of part alternatives (OEM, aftermarket, recycled, etc.). */
  alternatives: z.array(cccPartAlternativeSchema),

  /** Labor information for this part installation. */
  laborInfo: cccLaborInfoSchema.optional(),

  /** How stale the data is (ISO 8601 duration from X-Cache-Age header). */
  cacheAge: z.string().optional(),

  /** CCC-assigned request ID for support. */
  requestId: z.string().optional(),
}).passthrough();

/**
 * Type inference from schemas.
 */
export type CccPartAlternative = z.infer<typeof cccPartAlternativeSchema>;
export type CccPartsLookupResponse = z.infer<typeof cccPartsLookupResponseSchema>;
export type CccLaborInfo = z.infer<typeof cccLaborInfoSchema>;
