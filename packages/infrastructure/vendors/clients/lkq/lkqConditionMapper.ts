/**
 * Maps LKQ-specific condition/grade values to normalized values
 * compatible with the base vendorListingRecordSchema.
 *
 * LKQ uses a letter-grade system (A/B/C) for recycled parts quality,
 * and sometimes includes descriptive condition text. This mapper
 * normalizes both to standard condition strings that the downstream
 * DTOMapper can map to the domain PartCondition enum.
 */

/**
 * Map of LKQ part grades to normalized condition strings.
 *
 * These values are compatible with the PartCondition enum:
 * - A/B grades -> 'RECYCLED' (standard recycled quality)
 * - C grade -> 'RECONDITIONED' (functional but cosmetic issues)
 * - REMAN -> 'REMANUFACTURED' (rebuilt to OEM spec)
 */
const GRADE_TO_CONDITION: Record<string, string> = {
  'A': 'RECYCLED',
  'B': 'RECYCLED',
  'C': 'RECONDITIONED',
  'REMAN': 'REMANUFACTURED',
  'REMANUFACTURED': 'REMANUFACTURED',
  'NEW': 'NEW_AFTERMARKET',
  'NOS': 'NEW_OEM',          // New Old Stock (original OEM part)
};

/**
 * Descriptive condition text patterns and their mappings.
 */
const CONDITION_TEXT_PATTERNS: Array<{ pattern: RegExp; condition: string }> = [
  { pattern: /\bexcellent\b/i, condition: 'RECYCLED' },
  { pattern: /\bgood\b/i, condition: 'RECYCLED' },
  { pattern: /\bfair\b/i, condition: 'RECONDITIONED' },
  { pattern: /\brebuild\b/i, condition: 'REMANUFACTURED' },
  { pattern: /\bremanufactur/i, condition: 'REMANUFACTURED' },
  { pattern: /\bnew\s*oem\b/i, condition: 'NEW_OEM' },
  { pattern: /\baftermrkt\b|\baftermarket\b/i, condition: 'NEW_AFTERMARKET' },
  { pattern: /\bused\b/i, condition: 'RECYCLED' },
  { pattern: /\bsalvage\b/i, condition: 'RECYCLED' },
];

/**
 * Maps LKQ part grade and/or condition text to a normalized condition string.
 *
 * Priority:
 * 1. Explicit partGrade (A/B/C/REMAN) if recognized
 * 2. Condition text pattern matching
 * 3. Default: 'RECYCLED' (LKQ is primarily a recycler)
 *
 * @param partGrade - LKQ quality grade (e.g., 'A', 'B', 'C', 'REMAN')
 * @param conditionText - Free-text condition description from vendor
 * @returns Normalized condition string compatible with PartCondition enum
 */
export function mapLkqCondition(partGrade?: string, conditionText?: string): string {
  // 1. Try explicit grade mapping
  if (partGrade) {
    const normalized = partGrade.trim().toUpperCase();
    const mapped = GRADE_TO_CONDITION[normalized];
    if (mapped) {
      return mapped;
    }
  }

  // 2. Try condition text pattern matching
  if (conditionText) {
    for (const { pattern, condition } of CONDITION_TEXT_PATTERNS) {
      if (pattern.test(conditionText)) {
        return condition;
      }
    }
  }

  // 3. Default to RECYCLED (LKQ is a recycler)
  return 'RECYCLED';
}

/**
 * Maps LKQ availability status strings to normalized availability values.
 *
 * @param availability - Raw availability string from LKQ
 * @param quantity - Available quantity (if known)
 * @returns Normalized availability status string
 */
export function mapLkqAvailability(availability?: string, quantity?: number): string {
  if (availability) {
    const upper = availability.toUpperCase().trim();
    if (upper === 'IN_STOCK' || upper === 'AVAILABLE' || upper === 'IN STOCK') {
      return quantity !== undefined && quantity <= 2 ? 'LOW_STOCK' : 'IN_STOCK';
    }
    if (upper === 'BACKORDER' || upper === 'BACKORDERED' || upper === 'BACK ORDER') {
      return 'BACKORDER';
    }
    if (upper === 'SPECIAL_ORDER' || upper === 'SPECIAL ORDER') {
      return 'SPECIAL_ORDER';
    }
  }

  // Infer from quantity
  if (quantity !== undefined) {
    if (quantity > 0) {
      return quantity <= 2 ? 'LOW_STOCK' : 'IN_STOCK';
    }
    return 'BACKORDER';
  }

  return 'UNKNOWN';
}
