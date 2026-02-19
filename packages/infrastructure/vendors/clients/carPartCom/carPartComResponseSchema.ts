/**
 * Car-Part.com / Hollander-specific Zod schemas for response validation.
 *
 * Car-Part.com supports both:
 * 1. REST API for inventory search and interchange lookups
 * 2. HTML pages for scraping (fallback/enrichment)
 *
 * This schema handles the REST API JSON responses. HTML parsing
 * is handled by carPartComParser.ts.
 *
 * Key features:
 * - Hollander interchange database (cross-reference between OEM part numbers)
 * - Explicit part status: 'available', 'limited', 'out_of_stock'
 * - Salvage yard contact information
 * - Auction listings with explicit end dates
 */

import { z } from 'zod';
import { vendorListingRecordSchema } from '../../inventorySchema';

/**
 * Car-Part.com listing record schema.
 *
 * Extends base schema with recycler marketplace-specific fields:
 * - Hollander interchange numbers
 * - Part status from yard inventory system
 * - Salvage yard contact information
 * - Vehicle donor info
 * - Auction end dates (when applicable)
 */
export const carPartListingSchema = vendorListingRecordSchema
  .innerType()  // unwrap .refine() to extend
  .extend({
    /**
     * Part availability status from the recycler.
     * Unlike other vendors, Car-Part.com has explicit status values.
     */
    partStatus: z.enum(['available', 'limited', 'out_of_stock']).optional(),

    /** Hollander interchange number for cross-referencing. */
    hollanderNumber: z.string().optional(),

    /** OE interchange number (alternative to Hollander). */
    oeInterchangeNumber: z.string().optional(),

    /** Salvage yard name that holds this part. */
    yardName: z.string().optional(),

    /** Salvage yard phone number for direct contact. */
    yardPhone: z.string().optional(),

    /** Salvage yard city/state. */
    yardLocation: z.string().optional(),

    /** Donor vehicle mileage at time of salvage. */
    mileage: z.coerce.number().nonnegative().optional(),

    /** Donor vehicle VIN. */
    vehicleVin: z.string().optional(),

    /** Donor vehicle stock number at the yard. */
    yardStockNumber: z.string().optional(),

    /**
     * Auction end date for auction-based listings.
     * ISO 8601 format. Null for non-auction listings.
     */
    auctionEndDate: z.string().optional(),

    /** Estimated days to ship. */
    estimatedShipDays: z.coerce.number().int().nonnegative().optional(),

    /** Whether the yard offers a warranty on this part. */
    hasWarranty: z.boolean().optional(),

    /** Warranty period in days (if hasWarranty is true). */
    warrantyDays: z.coerce.number().int().nonnegative().optional(),

    /** Part row/location within the salvage yard. */
    yardRow: z.string().optional(),
  })
  .passthrough()
  .refine(
    (data) => {
      return !!(data.id || data.vendorListingId || data.listingId || data.url || data.sourceUrl || data.yardStockNumber);
    },
    {
      message: 'At least one identity field must be provided for Car-Part.com listing',
      path: ['id'],
    }
  );

/**
 * Car-Part.com search results response schema (REST API).
 */
export const carPartSearchResponseSchema = z.object({
  /** Array of listing records matching the search. */
  listings: z.array(carPartListingSchema),

  /** Cursor for the next page. */
  nextCursor: z.string().optional(),

  /** Whether more results are available. */
  hasMore: z.boolean(),

  /** Total results matching the query (approximate). */
  totalResults: z.number().optional(),

  /** Car-Part.com request tracking ID. */
  requestId: z.string().optional(),
}).passthrough();

/**
 * Hollander interchange lookup response.
 */
export const hollanderInterchangeResponseSchema = z.object({
  /** Queried Hollander number. */
  hollanderNumber: z.string(),

  /** OEM part numbers that interchange with this Hollander number. */
  interchanges: z.array(z.object({
    oemPartNumber: z.string(),
    make: z.string().optional(),
    model: z.string().optional(),
    yearFrom: z.number().optional(),
    yearTo: z.number().optional(),
    notes: z.string().optional(),
  })),

  /** Request tracking ID. */
  requestId: z.string().optional(),
}).passthrough();

/**
 * Type inference from schemas.
 */
export type CarPartListing = z.infer<typeof carPartListingSchema>;
export type CarPartSearchResponse = z.infer<typeof carPartSearchResponseSchema>;
export type HollanderInterchangeResponse = z.infer<typeof hollanderInterchangeResponseSchema>;
