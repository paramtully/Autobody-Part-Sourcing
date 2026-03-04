import { z } from 'zod';

// ── Schema ────────────────────────────────────────────────────────

const lkqListingSchema = z.object({
  // At least one identity field (checked in refine below)
  id: z.string().optional(),
  stockNumber: z.string().optional(),
  url: z.string().url().optional(),
  sourceUrl: z.string().url().optional(),
  // Part identification
  partNumber: z.string().optional(),
  oemPartNumber: z.string().optional(),
  // Attributes
  condition: z.string().optional(),
  partGrade: z.string().optional(),
  description: z.string().optional().nullable(),
  quantity: z.coerce.number().int().nonnegative().optional().nullable(),
  availability: z.string().optional(),
  // Pricing
  price: z.coerce.number().nonnegative().optional().nullable(),
  priceMin: z.coerce.number().nonnegative().optional().nullable(),
  priceMax: z.coerce.number().nonnegative().optional().nullable(),
  currency: z.string().optional(),
  // Logistics
  state: z.string().optional(),
  city: z.string().optional(),
  estimatedShipTimeHours: z.coerce.number().nonnegative().optional().nullable(),
  // Fitment
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.coerce.number().int().positive().optional().nullable(),
  trim: z.string().optional(),
  // Salvage provenance
  vehicleVin: z.string().max(17).optional(),
  mileage: z.coerce.number().nonnegative().optional().nullable(),
  damageType: z.string().optional(),
  hollanderNumber: z.string().optional(),
  // Images
  images: z.array(z.object({ url: z.string().url(), type: z.string().optional() }).passthrough()).optional().nullable(),
}).passthrough().refine(
  (d) => !!(d.id || d.stockNumber || d.url || d.sourceUrl),
  { message: 'At least one identity field required', path: ['id'] }
);

export const lkqPageSchema = z.object({
  listings: z.array(lkqListingSchema),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
}).passthrough();

export type LKQListingRecord = z.infer<typeof lkqListingSchema>;

// ── Condition / availability mapping ─────────────────────────────

const GRADE_TO_CONDITION: Record<string, string> = {
  A: 'RECYCLED', B: 'RECYCLED', C: 'RECONDITIONED',
  REMAN: 'REMANUFACTURED', REMANUFACTURED: 'REMANUFACTURED',
  NEW: 'NEW_AFTERMARKET', NOS: 'NEW_OEM',
};

const CONDITION_TEXT_PATTERNS: Array<{ pattern: RegExp; condition: string }> = [
  { pattern: /\bexcellent\b/i, condition: 'RECYCLED' },
  { pattern: /\bgood\b/i, condition: 'RECYCLED' },
  { pattern: /\bfair\b/i, condition: 'RECONDITIONED' },
  { pattern: /\bremanufactur/i, condition: 'REMANUFACTURED' },
  { pattern: /\bnew\s*oem\b/i, condition: 'NEW_OEM' },
  { pattern: /\baftermarket\b/i, condition: 'NEW_AFTERMARKET' },
  { pattern: /\b(used|salvage|recycled)\b/i, condition: 'RECYCLED' },
];

export function mapLkqCondition(partGrade?: string, conditionText?: string): string {
  if (partGrade) {
    const mapped = GRADE_TO_CONDITION[partGrade.trim().toUpperCase()];
    if (mapped) return mapped;
  }
  if (conditionText) {
    for (const { pattern, condition } of CONDITION_TEXT_PATTERNS) {
      if (pattern.test(conditionText)) return condition;
    }
  }
  return 'RECYCLED';
}

export function mapLkqAvailability(availability?: string, quantity?: number): string {
  if (availability) {
    const upper = availability.toUpperCase().trim();
    if (upper === 'IN_STOCK' || upper === 'AVAILABLE' || upper === 'IN STOCK')
      return quantity !== undefined && quantity <= 2 ? 'LOW_STOCK' : 'IN_STOCK';
    if (/^BACK.?ORDER$/i.test(upper)) return 'BACKORDER';
    if (/^SPECIAL.?ORDER$/i.test(upper)) return 'SPECIAL_ORDER';
  }
  if (quantity !== undefined)
    return quantity === 0 ? 'BACKORDER' : quantity <= 2 ? 'LOW_STOCK' : 'IN_STOCK';
  return 'UNKNOWN';
}