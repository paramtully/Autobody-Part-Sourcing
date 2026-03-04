import { z } from 'zod';

// ── Shared sub-schemas ────────────────────────────────────────────

const eBayMoneySchema = z.object({
    value: z.string(),
    currency: z.string(),
}).passthrough();

const eBayImageSchema = z.object({
    imageUrl: z.string().url(),
}).passthrough();

const eBayItemLocationSchema = z.object({
    city: z.string().optional(),
    stateOrProvince: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().optional(),
}).passthrough();

const eBaySellerSchema = z.object({
    username: z.string().optional(),
    feedbackPercentage: z.string().optional(),
    feedbackScore: z.number().optional(),
}).passthrough();

const eBayShippingOptionSchema = z.object({
    shippingCostType: z.string().optional(),
    shippingCost: eBayMoneySchema.optional(),
    maxEstimatedDeliveryDate: z.string().optional(),
    minEstimatedDeliveryDate: z.string().optional(),
}).passthrough();

const eBayReturnPeriodSchema = z.object({
    value: z.number().optional(),
    unit: z.string().optional(),
}).passthrough();

const eBayReturnTermsSchema = z.object({
    returnsAccepted: z.boolean().optional(),
    refundMethod: z.string().optional(),
    returnShippingCostPayer: z.string().optional(),
    returnPeriod: eBayReturnPeriodSchema.optional(),
}).passthrough();

const eBayCategorySchema = z.object({
    categoryId: z.string().optional(),
    categoryName: z.string().optional(),
}).passthrough();

const eBayEstimatedAvailabilitySchema = z.object({
    estimatedAvailableQuantity: z.number().int().nonnegative().optional().nullable(),
    estimatedSoldQuantity: z.number().int().nonnegative().optional().nullable(),
}).passthrough();

const eBayWarningSchema = z.object({
    errorId: z.number().optional(),
    message: z.string().optional(),
    category: z.string().optional(),
    domain: z.string().optional(),
    subdomain: z.string().optional(),
}).passthrough();

const eBayCompatibilityPropertySchema = z.object({
    name: z.string(),
    value: z.string(),
}).passthrough();

const eBayProductSchema = z.object({
    title: z.string().optional(),
    brand: z.string().optional(),
    mpn: z.string().optional(),
    aspects: z.record(z.array(z.string())).optional(),
}).passthrough();

// ── Item Detail Schema ────────────────────────────────────────────

export const eBayItemSchema = z.object({
    itemId: z.string(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    shortDescription: z.string().optional(),
    description: z.string().optional(),
    price: eBayMoneySchema.optional(),
    categoryPath: z.string().optional(),
    condition: z.string().optional(),
    conditionId: z.string().optional(),
    brand: z.string().optional(),
    mpn: z.string().optional(),
    seller: eBaySellerSchema.optional(),
    estimatedAvailability: eBayEstimatedAvailabilitySchema.optional(),
    itemLocation: eBayItemLocationSchema.optional(),
    shippingOptions: z.array(eBayShippingOptionSchema).optional(),
    returnTerms: eBayReturnTermsSchema.optional(),
    primaryCategory: eBayCategorySchema.optional(),
    additionalImages: z.array(eBayImageSchema).optional(),
    itemWebUrl: z.string().url().optional(),
    legacyItemId: z.string().optional(),
    warnings: z.array(eBayWarningSchema).optional(),
    compatibilityProperties: z.array(eBayCompatibilityPropertySchema).optional(),
    product: eBayProductSchema.optional(),
}).passthrough();

export type EBayItem = z.infer<typeof eBayItemSchema>;

// ── Condition mapping ─────────────────────────────────────────────

const EBAY_CONDITION_MAP: Record<string, string> = {
    'New': 'NEW_AFTERMARKET',
    'New with defects': 'NEW_AFTERMARKET',
    'Manufacturer refurbished': 'REMANUFACTURED',
    'Certified refurbished': 'REMANUFACTURED',
    'Seller refurbished': 'RECONDITIONED',
    'Like New': 'RECYCLED',
    'Very Good': 'RECYCLED',
    'Good': 'RECYCLED',
    'Acceptable': 'RECONDITIONED',
    'For parts or not working': 'RECONDITIONED',
    'Used': 'RECYCLED',
};

const EBAY_CONDITION_TEXT_PATTERNS: Array<{ pattern: RegExp; condition: string }> = [
    { pattern: /\bremanufactur/i, condition: 'REMANUFACTURED' },
    { pattern: /\brefurbish/i, condition: 'RECONDITIONED' },
    { pattern: /\bnew\b/i, condition: 'NEW_AFTERMARKET' },
    { pattern: /\blike\s+new\b/i, condition: 'RECYCLED' },
    { pattern: /\b(very\s+good|good)\b/i, condition: 'RECYCLED' },
    { pattern: /\b(used|salvage)\b/i, condition: 'RECYCLED' },
    { pattern: /\bparts?\s+only\b/i, condition: 'RECONDITIONED' },
];

export function mapEbayCondition(condition?: string): string {
    if (!condition) return 'RECYCLED';
    const exact = EBAY_CONDITION_MAP[condition.trim()];
    if (exact) return exact;
    for (const { pattern, condition: mapped } of EBAY_CONDITION_TEXT_PATTERNS) {
        if (pattern.test(condition)) return mapped;
    }
    return 'RECYCLED';
}

// ── Availability mapping ──────────────────────────────────────────

export function mapEbayItemAvailability(estimatedAvailableQuantity?: number | null): string {
    if (estimatedAvailableQuantity === undefined || estimatedAvailableQuantity === null)
        return 'UNKNOWN';
    if (estimatedAvailableQuantity === 0)
        return 'BACKORDER';
    if (estimatedAvailableQuantity <= 2)
        return 'LOW_STOCK';
    return 'IN_STOCK';
}
