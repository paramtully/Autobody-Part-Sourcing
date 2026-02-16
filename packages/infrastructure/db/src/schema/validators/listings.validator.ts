import { z } from 'zod';

export const partConditionSchema = z.enum([
    'NEW_OEM',
    'NEW_AFTERMARKET',
    'RECYCLED',
    'REMANUFACTURED',
    'RECONDITIONED',
    'UNKNOWN',
]);

export const availabilityStatusSchema = z.enum([
    'IN_STOCK',
    'LOW_STOCK',
    'BACKORDER',
    'SPECIAL_ORDER',
    'UNKNOWN',
]);

export const currencySchema = z.enum([
    'USD',
    'EUR',
    'GBP',
    'CAD',
    'AUD',
    'NZD',
    'CHF',
    'JPY',
    'KRW',
    'CNY',
]);

export const dataSourceTypeSchema = z.enum([
    'VENDOR_API',
    'SCRAPER',
    'CSV_UPLOAD',
    'MANUAL_ENTRY',
]);

export const listingSchema = z
    .object({
        vendorId: z.string().uuid(),
        partId: z.string().uuid(),
        vendorListingExternalId: z.string().min(1).optional(),
        sourceUrl: z.string().url().optional(),
        condition: partConditionSchema,
        description: z.string().optional(),
        quantityAvailable: z.number().int().nonnegative().optional(),
        availabilityStatus: availabilityStatusSchema,
        priceMinorMin: z.number().int().nonnegative(),
        priceMinorMax: z.number().int().nonnegative().optional(),
        currency: currencySchema,
        warehouseLocationId: z.string().uuid().optional(),
        estimatedShipTimeHours: z.number().int().positive().optional(),
        estimatedDeliveryDate: z.date().optional(),
        source: dataSourceTypeSchema,
        confidenceScore: z.number().min(0).max(1).optional().refine(
            (val) => val === undefined || (val * 100) % 1 === 0,
            { message: 'confidenceScore must have at most 2 decimal places' }
        ),
        isActive: z.boolean().default(true),
        // Payload fingerprint for change detection
        payloadHash: z.string().regex(/^[a-f0-9]{64}$/i, 'Must be a valid SHA-256 hash').optional().nullable(),
        // Lifecycle fields
        consecutiveMissCount: z.number().int().nonnegative().default(0),
        lastSeenAt: z.date().optional(),
        markedInactiveAt: z.date().optional().nullable(),
        inactiveReason: z.string().max(100).optional().nullable(),
    })
    .refine(
        (data) => {
            if (data.priceMinorMax !== undefined) {
                return data.priceMinorMax >= data.priceMinorMin;
            }
            return true;
        },
        {
            message: 'priceMinorMax must be >= priceMinorMin',
            path: ['priceMinorMax'],
        }
    )
    .refine(
        (data) => {
            // At least one of vendorListingExternalId or sourceUrl must be present
            return data.vendorListingExternalId !== undefined || data.sourceUrl !== undefined;
        },
        {
            message: 'Either vendorListingExternalId or sourceUrl must be provided',
            path: ['vendorListingExternalId'],
        }
    );

export const createListingSchema = listingSchema;
