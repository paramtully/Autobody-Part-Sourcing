/**
 * Configuration for canonicalization volatile fields and business identity hints.
 *
 * Volatile fields:
 * - Removed from the canonical payload before hashing
 * - Intended for request/transport metadata that does NOT represent business data
 *
 * Business identity hints:
 * - Fields that SHOULD influence payloadHash and therefore change detection
 * - These must NOT appear in VOLATILE_FIELDS
 */

/**
 * Fields that are considered volatile and should not affect payload hashes.
 * Each entry should have a clear rationale in the comments below.
 */
export const VOLATILE_FIELDS: ReadonlySet<string> = new Set<string>([
    // Request-scoped identifiers (do not represent listing state)
    'requestId',
    'correlationId',
    'trace',
    'span',

    // Session / auth tokens
    'sessionToken',

    // Timestamps related to scraping / transport, not listing business data
    'scrapeTimestamp',
    'scrapedAt',
    'requestTimestamp',
    'requestTime',
    'responseTime',
    'processingTime',
    'fetchedAt',
    'ingestionTimestamp',

    // Generic debugging / metadata blobs
    'metadata',
    'debug',
]);

/**
 * Hint list of fields that SHOULD influence business identity / change detection.
 * This is informational and used for tests/documentation to ensure we do not
 * accidentally treat these as volatile.
 */
export const BUSINESS_IDENTITY_FIELD_HINTS = [
    'price',
    'priceMin',
    'priceMax',
    'priceMinorMin',
    'priceMinorMax',
    'quantity',
    'quantityAvailable',
    'availability',
    'availabilityStatus',
    'isActive',
    'condition',
    'warehouseLocation',
    'country',
    'stateOrProvince',
    'city',
    'postalCode',
    'estimatedShipTime',
    'estimatedShipTimeHours',
    'estimatedDeliveryDate',
] as const;

