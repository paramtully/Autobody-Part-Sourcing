/**
 * Maps CCC One part quality grades to normalized condition values
 * compatible with the base vendorListingRecordSchema.
 *
 * CCC One uses a structured partQuality enum rather than free-text grades.
 * This mapper translates CCC's quality classifications to standard
 * condition strings that the downstream DTOMapper can map to PartCondition.
 */

/**
 * Map of CCC One partQuality values to normalized condition strings.
 *
 * Aligned with PartCondition enum:
 * - OEM -> NEW_OEM
 * - OEM_SURPLUS -> NEW_OEM (new but from overstock)
 * - AFTERMARKET -> NEW_AFTERMARKET
 * - RECYCLED -> RECYCLED
 * - REMANUFACTURED -> REMANUFACTURED
 */
const QUALITY_TO_CONDITION: Record<string, string> = {
  'OEM': 'NEW_OEM',
  'OEM_SURPLUS': 'NEW_OEM',
  'AFTERMARKET': 'NEW_AFTERMARKET',
  'RECYCLED': 'RECYCLED',
  'REMANUFACTURED': 'REMANUFACTURED',
};

/**
 * Maps CCC One part quality to a normalized condition string.
 *
 * @param partQuality - CCC partQuality enum value
 * @param conditionText - Fallback free-text condition (if partQuality absent)
 * @returns Normalized condition string compatible with PartCondition enum
 */
export function mapCccCondition(partQuality?: string, conditionText?: string): string {
  if (partQuality) {
    const mapped = QUALITY_TO_CONDITION[partQuality.toUpperCase()];
    if (mapped) return mapped;
  }

  // Fallback to condition text analysis
  if (conditionText) {
    const upper = conditionText.toUpperCase().trim();
    if (upper.includes('OEM') || upper.includes('ORIGINAL')) return 'NEW_OEM';
    if (upper.includes('AFTERMARKET') || upper.includes('AM')) return 'NEW_AFTERMARKET';
    if (upper.includes('RECYCLED') || upper.includes('USED') || upper.includes('SALVAGE')) return 'RECYCLED';
    if (upper.includes('REMAN') || upper.includes('REBUILT')) return 'REMANUFACTURED';
  }

  return 'UNKNOWN';
}

/**
 * Maps CCC One availability to normalized availability status.
 *
 * CCC One is a reference database, not live inventory. Most parts
 * are listed as SPECIAL_ORDER since they're estimates, not in-stock items.
 *
 * @param partQuality - CCC partQuality value (affects availability interpretation)
 * @returns Normalized availability status string
 */
export function mapCccAvailability(partQuality?: string): string {
  if (partQuality === 'OEM' || partQuality === 'OEM_SURPLUS') {
    return 'SPECIAL_ORDER'; // OEM parts typically require dealer ordering
  }
  if (partQuality === 'AFTERMARKET') {
    return 'IN_STOCK'; // Aftermarket usually available
  }
  if (partQuality === 'RECYCLED') {
    return 'UNKNOWN'; // Recycled availability varies widely
  }

  return 'UNKNOWN';
}

/**
 * Derives a confidence score from CCC One estimate data.
 *
 * CCC's own estimateConfidence is used if available. Otherwise,
 * a heuristic score is computed based on data completeness.
 *
 * @param estimateConfidence - CCC-provided confidence (0-1)
 * @param cacheAge - Cache age string (older = lower confidence)
 * @param certifications - Part certifications (more = higher confidence)
 * @returns Confidence score between 0 and 1
 */
export function deriveCccConfidence(
  estimateConfidence?: number,
  cacheAge?: string,
  certifications?: string[]
): number {
  // Use CCC's own confidence if provided
  if (estimateConfidence !== undefined) {
    return estimateConfidence;
  }

  let score = 0.7; // Base confidence for CCC data

  // Reduce confidence for stale data
  if (cacheAge) {
    const hours = parseCacheAgeHours(cacheAge);
    if (hours > 168) score -= 0.2;      // > 1 week
    else if (hours > 48) score -= 0.1;  // > 2 days
  }

  // Increase confidence for certified parts
  if (certifications && certifications.length > 0) {
    score += 0.05 * Math.min(certifications.length, 2);
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Parse ISO 8601 duration string to hours.
 * Handles simple formats: PT4H, PT30M, P1D, P7D, etc.
 */
function parseCacheAgeHours(duration: string): number {
  const dayMatch = duration.match(/P(\d+)D/);
  const hourMatch = duration.match(/PT?(\d+)H/);
  const minuteMatch = duration.match(/PT?(\d+)M/);

  let hours = 0;
  if (dayMatch) hours += parseInt(dayMatch[1], 10) * 24;
  if (hourMatch) hours += parseInt(hourMatch[1], 10);
  if (minuteMatch) hours += parseInt(minuteMatch[1], 10) / 60;

  return hours;
}
