import { z } from 'zod';

// ── Shared sub-schemas ────────────────────────────────────────────

const eBayMoneySchema = z.object({
    value: z.string(),
    currency: z.string(),
}).passthrough();

const eBayCategorySchema = z.object({
    categoryId: z.string().optional(),
    categoryName: z.string().optional(),
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
}).passthrough();

// ── Item Summary Schema ───────────────────────────────────────────

const eBayItemSummarySchema = z.object({
    itemId: z.string(),
    title: z.string().optional(),
    leafCategoryIds: z.array(z.string()).optional(),
    categories: z.array(eBayCategorySchema).optional(),
    image: eBayImageSchema.optional(),
    additionalImages: z.array(eBayImageSchema).optional(),
    price: eBayMoneySchema.optional(),
    strikeThroughPrice: eBayMoneySchema.optional(),
    itemLocation: eBayItemLocationSchema.optional(),
    seller: eBaySellerSchema.optional(),
    condition: z.string().optional(),
    conditionId: z.string().optional(),
    shippingOptions: z.array(eBayShippingOptionSchema).optional(),
    buyingOptions: z.array(z.string()).optional(),
    currentBidPrice: eBayMoneySchema.optional(),
    epid: z.string().optional(),
    itemAffiliateWebUrl: z.string().url().optional(),
    itemWebUrl: z.string().url().optional(),
    itemEndDate: z.string().optional(),
    itemCreationDate: z.string().optional(),
    priorityListing: z.boolean().optional(),
    adultOnly: z.boolean().optional(),
    legacyItemId: z.string().optional(),
    availableCoupons: z.boolean().optional(),
}).passthrough();

// ── Page / Search Response Schema ────────────────────────────────

export const eBaySearchResponseSchema = z.object({
    href: z.string().optional(),
    total: z.number().int().nonnegative().optional(),
    next: z.string().optional(),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    itemSummaries: z.array(eBayItemSummarySchema).optional().default([]),
}).passthrough();

export type EBayItemSummary = z.infer<typeof eBayItemSummarySchema>;
export type EBaySearchResponse = z.infer<typeof eBaySearchResponseSchema>;

// ── Condition mapping ─────────────────────────────────────────────
// eBay condition strings for used / salvage parts

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
// Search results don't expose quantity; presence in results implies availability.

export function mapEbaySearchAvailability(itemEndDate?: string): string {
    if (itemEndDate) {
        const ended = new Date(itemEndDate) < new Date();
        if (ended) return 'BACKORDER';
    }
    return 'IN_STOCK';
}
