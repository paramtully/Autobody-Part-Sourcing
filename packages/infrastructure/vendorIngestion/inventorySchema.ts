import { z } from 'zod';

/**
 * Base Zod schema for vendor inventory responses.
 * 
 * This schema is designed to:
 * - Safely validate unreliable vendor data
 * - Allow unknown fields via passthrough (schema drift tolerance)
 * - Support missing optional fields
 * - Produce structures safe for DTO mapping and canonicalization
 * - Handle type coercion (strings to numbers, dates, etc.)
 * 
 * Vendor-specific implementations should extend this base schema.
 */

/**
 * Schema for a single inventory listing record from vendor.
 * All fields are optional except minimum identity requirements.
 */
export const vendorListingRecordSchema = z
  .object({
    // Identity fields (at least one required)
    id: z.string().optional(),
    vendorListingId: z.string().optional(),
    listingId: z.string().optional(),
    url: z.string().url().optional(),
    sourceUrl: z.string().url().optional(),

    // Part identification
    partNumber: z.string().optional(),
    oemPartNumber: z.string().optional(),
    aftermarketPartNumber: z.string().optional(),
    manufacturer: z.string().optional(),
    brand: z.string().optional(),

    // Listing attributes
    condition: z.string().optional(),
    description: z.string().optional().nullable(),
    quantity: z.coerce.number().int().nonnegative().optional().nullable(),
    quantityAvailable: z.coerce.number().int().nonnegative().optional().nullable(),
    availability: z.string().optional(),
    availabilityStatus: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
    active: z.coerce.boolean().optional(),

    // Pricing
    price: z.coerce.number().nonnegative().optional().nullable(),
    priceMin: z.coerce.number().nonnegative().optional().nullable(),
    priceMax: z.coerce.number().nonnegative().optional().nullable(),
    currency: z.string().optional(),
    originalPrice: z.string().optional(),

    // Logistics
    warehouse: z.string().optional(),
    location: z.string().optional(),
    country: z.string().optional(),
    state: z.string().optional(),
    stateOrProvince: z.string().optional(),
    city: z.string().optional(),
    postalCode: z.string().optional(),
    estimatedShipTime: z.coerce.number().nonnegative().optional().nullable(),
    estimatedShipTimeHours: z.coerce.number().nonnegative().optional().nullable(),
    estimatedDeliveryDate: z.string().optional(), // ISO string or vendor format

    // Fitment
    make: z.string().optional(),
    model: z.string().optional(),
    year: z.coerce.number().int().positive().optional().nullable(),
    yearFrom: z.coerce.number().int().positive().optional().nullable(),
    yearTo: z.coerce.number().int().positive().optional().nullable(),
    trim: z.string().optional(),
    trims: z.array(z.string()).optional().nullable(),
    engine: z.string().optional(),
    constraints: z.array(z.string()).optional().nullable(),
    fitmentText: z.string().optional(),

    // Source vehicle provenance (salvage/recycled parts)
    vehicleVin: z.string().max(17).optional(),
    mileage: z.coerce.number().nonnegative().optional().nullable(),
    damageType: z.string().optional(),

    // Interchange
    interchangeSystem: z.string().optional(),
    interchangeCode: z.string().optional(),
    interchangeGroupId: z.string().optional(),
    interchangeText: z.string().optional(),

    // Images
    images: z
      .array(
        z
          .object({
            url: z.string().url(),
            type: z.string().optional(),
            imageType: z.string().optional(),
            source: z.string().optional(),
            sortOrder: z.coerce.number().int().nonnegative().optional(),
          })
          .passthrough()
      )
      .optional()
      .nullable(),

    // Timestamps
    updatedAt: z.string().optional(),
    lastUpdated: z.string().optional(),
    vendorUpdatedAt: z.string().optional(),
    createdAt: z.string().optional(),

    // Metadata
    confidence: z.coerce.number().min(0).max(1).optional().nullable(),
    confidenceScore: z.coerce.number().min(0).max(1).optional().nullable(),
  })
  .passthrough() // Allow unknown fields - critical for schema drift tolerance
  .refine(
    (data) => {
      // At least one identity field must be present
      return !!(data.id || data.vendorListingId || data.listingId || data.url || data.sourceUrl);
    },
    {
      message: 'At least one identity field (id, vendorListingId, listingId, url, or sourceUrl) must be provided',
      path: ['id'],
    }
  );

/**
 * Schema for paginated vendor inventory response.
 */
export const vendorInventoryResponseSchema = z
  .object({
    listings: z.array(vendorListingRecordSchema).optional(),
    records: z.array(vendorListingRecordSchema).optional(),
    items: z.array(vendorListingRecordSchema).optional(),
    data: z.array(vendorListingRecordSchema).optional(),

    // Pagination metadata
    nextCursor: z.string().optional(),
    nextPageToken: z.string().optional(),
    cursor: z.string().optional(),
    hasMore: z.coerce.boolean().optional(),
    hasNextPage: z.coerce.boolean().optional(),
    page: z.coerce.number().int().positive().optional(),
    totalPages: z.coerce.number().int().positive().optional(),
    totalRecords: z.coerce.number().int().nonnegative().optional(),
  })
  .passthrough() // Allow unknown fields at response level
  .transform((data) => {
    // Normalize different array field names to a single 'listings' field
    const listings =
      data.listings ||
      data.records ||
      data.items ||
      data.data ||
      [];

    return {
      listings,
      nextCursor: data.nextCursor || data.nextPageToken || data.cursor,
      hasMore: data.hasMore ?? data.hasNextPage ?? false,
      page: data.page,
      totalPages: data.totalPages,
      totalRecords: data.totalRecords,
      // Preserve all other fields
      ...Object.fromEntries(
        Object.entries(data).filter(
          ([key]) =>
            !['listings', 'records', 'items', 'data', 'nextCursor', 'nextPageToken', 'cursor', 'hasMore', 'hasNextPage', 'page', 'totalPages', 'totalRecords'].includes(key)
        )
      ),
    };
  });

/**
 * Type inference from the schema.
 */
export type VendorInventoryResponse = z.infer<typeof vendorInventoryResponseSchema>;
export type VendorListingRecord = z.infer<typeof vendorListingRecordSchema>;

/**
 * Helper function to validate and parse vendor inventory response.
 * 
 * @param data - Raw JSON data from vendor API
 * @returns Validated and normalized response
 * @throws ZodError if validation fails
 */
export function validateVendorInventoryResponse(
  data: unknown
): VendorInventoryResponse {
  return vendorInventoryResponseSchema.parse(data);
}

/**
 * Helper function to safely validate vendor inventory response.
 * Returns result object instead of throwing.
 * 
 * @param data - Raw JSON data from vendor API
 * @returns Validation result with success flag
 */
export function safeValidateVendorInventoryResponse(data: unknown): {
  success: boolean;
  data?: VendorInventoryResponse;
  error?: z.ZodError;
} {
  const result = vendorInventoryResponseSchema.safeParse(data);
  return {
    success: result.success,
    data: result.success ? result.data : undefined,
    error: result.success ? undefined : result.error,
  };
}
