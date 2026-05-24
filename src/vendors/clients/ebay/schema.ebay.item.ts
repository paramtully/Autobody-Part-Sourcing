import { z } from 'zod';
import type { FitmentConstraint } from '../vendorRecord';

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
    estimatedRemainingQuantity: z.number().int().nonnegative().optional().nullable(),
    estimatedSoldQuantity: z.number().int().nonnegative().optional().nullable(),
    estimatedAvailabilityStatus: z.string().optional(),
    deliveryOptions: z.array(z.string()).optional(),
    availabilityThresholdType: z.string().optional(),
    availabilityThreshold: z.number().int().optional(),
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
    aspects: z.record(z.string(), z.array(z.string())).optional(),
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
    estimatedAvailabilities: z.array(eBayEstimatedAvailabilitySchema).optional(),
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
    localizedAspects: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    // Injected by fetchInventoryPage after Trading API enrichment — not from eBay directly
    _fitments: z.array(z.object({
        make: z.string(), model: z.coerce.string(), year: z.number(),
        trim: z.string().optional(), engine: z.string().optional(),
    })).optional(),
}).passthrough();

/** Merges localizedAspects (primary) + product.aspects (fallback) into a single lookup map. */
export function buildAspectMap(item: EBayItem): EbayAspects {
    const map: EbayAspects = {};
    for (const [k, v] of Object.entries(item.product?.aspects ?? {})) map[k] = v;
    for (const { name, value } of item.localizedAspects ?? []) map[name] = [value];
    return map;
}

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

// ── Constraint mapping ────────────────────────────────────────────

type EbayAspects = Record<string, string[]>;

function getAspect(aspects: EbayAspects, key: string): string | undefined {
    return aspects[key]?.[0];
}

/** Maps eBay product.aspects to a fitment constraint.
 *  Returns the first matching constraint found, or undefined if none apply. */
export function mapEbayConstraint(aspects?: EbayAspects): FitmentConstraint | undefined {
    if (!aspects) return undefined;

    const parkingSensors = getAspect(aspects, 'Parking Sensors');
    if (parkingSensors === 'With') return 'WITH_PARKING_SENSORS';
    if (parkingSensors === 'Without') return 'WITHOUT_PARKING_SENSORS';

    const radar = getAspect(aspects, 'Blind Spot Sensor') ?? getAspect(aspects, 'Radar');
    if (radar === 'With') return 'WITH_RADAR';
    if (radar === 'Without') return 'WITHOUT_RADAR';

    const camera = getAspect(aspects, 'Backup Camera') ?? getAspect(aspects, 'Camera');
    if (camera === 'With') return 'WITH_CAMERA';
    if (camera === 'Without') return 'WITHOUT_CAMERA';

    const headlightType = getAspect(aspects, 'Headlight Type');
    if (headlightType === 'LED') return 'LED';
    if (headlightType === 'Halogen') return 'HALOGEN';
    if (headlightType === 'HID') return 'HID';
    if (headlightType === 'Adaptive') return 'ADAPTIVE';

    const driveType = getAspect(aspects, 'Drive Type');
    if (driveType === 'AWD') return 'AWD';
    if (driveType === 'FWD') return 'FWD';
    if (driveType === 'RWD') return 'RWD';

    const sunroof = getAspect(aspects, 'Sunroof');
    if (sunroof === 'With') return 'SUNROOF';
    if (sunroof === 'Without') return 'NO_SUNROOF';

    return undefined;
}

// ── Category mapping ──────────────────────────────────────────────

/** Maps eBay categoryPath / categoryName (+ optional free-text hints) to a part_category enum value.
 *  Hints (e.g. aspects['Type'] + item.title) are prepended so they take priority over the broad
 *  breadcrumb — this resolves misclassifications like "Quarter Panel" under a "Fenders" path.
 *  Checks most-specific patterns first, falling back to 'OTHER'. */
export function mapEbayCategory(categoryPath?: string, categoryName?: string, hints?: string): string {
    const text = [hints, categoryPath, categoryName].filter(Boolean).join(' ').toLowerCase();

    // Most-specific patterns first to avoid false positives on broader terms
    if (/bumper\s*(cover|fascia)/.test(text)) return 'BUMPER_COVER';
    if (/bumper\s*(reinforcement|impact\s*bar)/.test(text)) return 'BUMPER_BEAM';
    if (/bumper\s*beam/.test(text)) return 'BUMPER_BEAM';
    if (/bumper\s*bracket/.test(text)) return 'BUMPER_BRACKET';
    if (/bumper\s*foam|absorber/.test(text)) return 'BUMPER_FOAM';
    if (/bumper/.test(text)) return 'BUMPER';

    if (/fender\s*liner|wheel\s*(well|arch)\s*liner/.test(text)) return 'FENDER_LINER';
    if (/wheel\s*(well|arch)/.test(text)) return 'WHEEL_ARCH';
    // Specific panel sub-types must come before generic 'fender' to avoid false positives
    // when a "Quarter Panel" hint appears alongside a "Fenders" categoryPath.
    if (/quarter\s*panel/.test(text)) return 'QUARTER_PANEL';
    if (/rocker\s*panel/.test(text)) return 'ROCKER_PANEL';
    if (/roof\s*panel/.test(text)) return 'ROOF_PANEL';
    if (/fender/.test(text)) return 'FENDER';

    if (/door\s*handle/.test(text)) return 'DOOR_HANDLE';
    if (/door\s*lock/.test(text)) return 'DOOR_LOCK';
    if (/door\s*glass/.test(text)) return 'DOOR_GLASS';
    if (/door\s*mirror/.test(text)) return 'DOOR_MIRROR';
    if (/hinge/.test(text) && /door/.test(text)) return 'HINGE';
    if (/door/.test(text)) return 'DOOR';

    if (/hood\s*hinge/.test(text)) return 'HOOD_HINGE';
    if (/hood\s*latch/.test(text)) return 'HOOD_LATCH';
    if (/\bhoods?\b/.test(text)) return 'HOOD';

    if (/trunk\s*hinge/.test(text)) return 'TRUNK_HINGE';
    if (/trunk\s*latch/.test(text)) return 'TRUNK_LATCH';
    if (/tailgate|lift\s*gate|liftgate/.test(text)) return 'TRUNK_LID';
    if (/trunk\s*(lid|deck)/.test(text)) return 'TRUNK_LID';

    if (/headlight|head\s*lamp/.test(text)) return 'HEADLIGHT';
    if (/taillight|tail\s*lamp|tail\s*light/.test(text)) return 'TAILLIGHT';
    if (/fog\s*light|fog\s*lamp/.test(text)) return 'FOG_LIGHT';
    if (/turn\s*signal|signal\s*light/.test(text)) return 'TURN_SIGNAL';
    if (/marker\s*light/.test(text)) return 'MARKER_LIGHT';
    if (/reverse\s*light|backup\s*light/.test(text)) return 'REVERSE_LIGHT';
    if (/interior\s*light/.test(text)) return 'INTERIOR_LIGHT';

    if (/windshield|windscreen/.test(text)) return 'WINDSHIELD';
    if (/rear\s*(window|glass|windshield)/.test(text)) return 'REAR_WINDOW';
    if (/sunroof\s*glass/.test(text)) return 'SUNROOF_GLASS';
    if (/side\s*(window|glass)/.test(text)) return 'SIDE_WINDOW';

    if (/\bgrilles?\b/.test(text)) return 'GRILLE';
    if (/moldings?|mouldings?/.test(text)) return 'MOLDING';
    if (/trim\s*piece|body\s*trim|trim\s*panel/.test(text)) return 'TRIM_PIECE';
    if (/\bbadge\b/.test(text)) return 'BADGE';
    if (/emblem/.test(text)) return 'EMBLEM';

    if (/mirror\s*glass/.test(text)) return 'MIRROR_GLASS';
    if (/mirror\s*cover/.test(text)) return 'MIRROR_COVER';
    if (/mirror/.test(text)) return 'MIRROR';

    if (/radiator\s*support/.test(text)) return 'RADIATOR_SUPPORT';
    if (/core\s*support/.test(text)) return 'CORE_SUPPORT';

    if (/frame\s*rail/.test(text)) return 'FRAME_RAIL';
    if (/unibody/.test(text)) return 'UNIBODY_PANEL';
    if (/crossmember/.test(text)) return 'CROSSMEMBER';

    if (/wheel\s*cover|hub\s*cap/.test(text)) return 'WHEEL_COVER';
    if (/\bwheels?\b/.test(text)) return 'WHEEL';
    if (/\btires?\b/.test(text)) return 'TIRE';

    if (/parking\s*sensors?/.test(text)) return 'PARKING_SENSOR';
    if (/blind\s*spot\s*sensors?/.test(text)) return 'BLIND_SPOT_SENSOR';
    if (/\bcameras?\b/.test(text)) return 'CAMERA';
    if (/radar\s*sensors?/.test(text)) return 'RADAR_SENSOR';
    if (/leveling\s*sensor/.test(text)) return 'HEADLIGHT_LEVELING_SENSOR';

    if (/\bbracket\b/.test(text)) return 'BRACKET';
    if (/\bmount\b/.test(text)) return 'MOUNT';
    if (/\bsupport\b/.test(text)) return 'SUPPORT';

    if (/weatherstrip/.test(text)) return 'WEATHERSTRIP';
    if (/\bseal\b/.test(text)) return 'SEAL';
    if (/\bgasket\b/.test(text)) return 'GASKET';

    return 'OTHER';
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

// ── Position mapping ──────────────────────────────────────────────

/** Maps eBay "Placement on Vehicle" aspect + category to a part_position enum value.
 *  Returns undefined only when placement is truly ambiguous (pair listing: both left+right
 *  or both front+rear). Single-side values like "Rear, Left" parse correctly. */
export function mapEbayPosition(category: string, placement?: string): string | undefined {
    if (!placement) return undefined;
    const p = placement.toLowerCase();
    const isLeft  = /\b(left|driver|lh|l\/h|d\/?s)\b/.test(p);
    const isRight = /\b(right|passenger|rh|r\/h|p\/?s)\b/.test(p);
    const isFront = /\bfront\b/.test(p);
    const isRear  = /\b(rear|back)\b/.test(p);

    // Truly ambiguous: pair listing ("Left, Right") or universal kit ("Front, Rear")
    if ((isLeft && isRight) || (isFront && isRear)) return undefined;

    switch (category) {
        case 'HEADLIGHT':    return isLeft ? 'HEADLIGHT_LEFT'    : isRight ? 'HEADLIGHT_RIGHT'    : undefined;
        case 'TAILLIGHT':    return isLeft ? 'TAILLIGHT_LEFT'    : isRight ? 'TAILLIGHT_RIGHT'    : undefined;
        case 'MIRROR':
        case 'DOOR_MIRROR':  return isLeft ? 'MIRROR_LEFT'       : isRight ? 'MIRROR_RIGHT'       : undefined;
        case 'FENDER':       return isLeft && isRear ? 'REAR_LEFT_FENDER' : isRight && isRear ? 'REAR_RIGHT_FENDER'
                                  : isLeft ? 'FRONT_LEFT_FENDER' : isRight ? 'FRONT_RIGHT_FENDER' : undefined;
        case 'FENDER_LINER': return isLeft ? 'FENDER_LINER_LEFT' : isRight ? 'FENDER_LINER_RIGHT' : undefined;
        case 'DOOR':
        case 'DOOR_HANDLE':  return isLeft && isFront ? 'FRONT_LEFT_DOOR' : isRight && isFront ? 'FRONT_RIGHT_DOOR'
                                  : isLeft && isRear  ? 'REAR_LEFT_DOOR'  : isRight && isRear  ? 'REAR_RIGHT_DOOR' : undefined;
        case 'QUARTER_PANEL': return isLeft ? 'QUARTER_PANEL_LEFT' : isRight ? 'QUARTER_PANEL_RIGHT' : undefined;
        case 'SIDE_WINDOW':  return isLeft ? 'SIDE_WINDOW_LEFT'  : isRight ? 'SIDE_WINDOW_RIGHT'  : undefined;
        case 'BUMPER':
        case 'BUMPER_COVER':
        case 'BUMPER_BEAM':
        case 'BUMPER_BRACKET':
        case 'BUMPER_FOAM':  return isFront ? 'FRONT_BUMPER' : isRear ? 'REAR_BUMPER' : undefined;
        default:             return undefined;
    }
}

// ── Weight parsing ────────────────────────────────────────────────

/** Parses eBay "Item Weight" aspect string (e.g. "5.2 lb", "350 g") to grams. */
export function parseItemWeightGrams(weightStr?: string): number | undefined {
    if (!weightStr) return undefined;
    const m = weightStr.match(/(\d+(?:\.\d+)?)\s*(lb|lbs|oz|kg|g)\b/i);
    if (!m) return undefined;
    const v = parseFloat(m[1]);
    switch (m[2].toLowerCase()) {
        case 'lb': case 'lbs': return Math.round(v * 453.592);
        case 'oz':             return Math.round(v * 28.3495);
        case 'kg':             return Math.round(v * 1000);
        case 'g':              return Math.round(v);
        default:               return undefined;
    }
}

// ── Certification mapping ─────────────────────────────────────────

/** Returns CAPA or NSF certification if present in product aspects. */
export function mapEbayCertification(aspects?: EbayAspects): 'CAPA' | 'NSF' | undefined {
    const cert = aspects?.['Certification']?.[0]?.toUpperCase() ?? '';
    if (cert.includes('CAPA')) return 'CAPA';
    if (cert.includes('NSF'))  return 'NSF';
    return undefined;
}

// ── VIN / damage extraction ───────────────────────────────────────

export function extractVin(text: string): string | undefined {
    return text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0];
}

export function extractDamageType(text: string): string | undefined {
    if (/collision|wrecked/i.test(text)) return 'COLLISION';
    if (/flood/i.test(text))             return 'FLOOD';
    if (/hail/i.test(text))              return 'HAIL';
    if (/salvage/i.test(text))           return 'SALVAGE';
    return undefined;
}

// ── Identifier classification ─────────────────────────────────────

// Partslink prefixes: CAPA/NSF standard 2-letter prefix encodes manufacturer.
// Conservative set seeded from real captured data + CAPA prefix list.
const PARTSLINK_PREFIX_TO_MAKE: Record<string, string> = {
    HO: 'Honda',    AC: 'Acura',
    FO: 'Ford',     LR: 'Lincoln',
    GM: 'GM',       CV: 'Chevrolet',
    NI: 'Nissan',   IN: 'Infiniti',
    TO: 'Toyota',   LX: 'Lexus',   SC: 'Scion',
    HY: 'Hyundai',  KI: 'Kia',
    MA: 'Mazda',    SU: 'Subaru',
    MB: 'Mercedes-Benz', BM: 'BMW', AU: 'Audi', VW: 'Volkswagen',
    JE: 'Jeep',     CH: 'Chrysler', DG: 'Dodge', RA: 'Ram',
    MI: 'Mitsubishi', VO: 'Volvo',
};

// OEM number formats, anchored. Order matters — more specific first.
// Seeded from real data captured during investigation (see docs/ebay-data-quality-investigation.md).
// All values are dash-normalized before matching (dashes stripped at ingestion).
const OEM_PATTERNS: Array<{ pattern: RegExp; manufacturer: string }> = [
    { pattern: /^\d{5}[A-Z0-9]{3}[A-Z0-9]{4}[A-Z]{0,2}$/, manufacturer: 'Honda' },         // 04711TBAA90ZZ (was 04711-TBA-A90ZZ)
    { pattern: /^[0-9][A-Z]\d[A-Z]\d{5}[A-Z]?$/,          manufacturer: 'Ford' },           // 8G1Z13008F
    { pattern: /^\d{5}[A-Z0-9]{4}[A-Z]$/,                 manufacturer: 'Nissan' },          // 622566CA0A (was 62256-6CA0A)
    { pattern: /^A?\d{10}$/,                               manufacturer: 'Mercedes-Benz' },  // 9068810101
    { pattern: /^\d{10}$/,                                 manufacturer: 'Toyota' },          // 5381112345 (was 53811-12345)
    // Hyundai/Kia share a Mobis-derived scheme; cannot distinguish by pattern alone
    { pattern: /^\d{5}[A-Z0-9]{5}$/,                      manufacturer: 'Hyundai/Kia' },    // 92101D5000
    { pattern: /^\d{8}$/,                                  manufacturer: 'GM' },              // 84790367 — keep LAST (loosest)
];

const UPC_EAN_PATTERN = /^\d{12,14}$/;

export interface ClassifiedIdentifier {
    type: 'OEM' | 'AFTERMARKET' | 'INTERCHANGE';
    manufacturer?: string;
}

/** Pattern-classifies a raw part number value.
 *  Returns null for UPCs/EANs (caller should drop entirely).
 *  Returns undefined when no pattern matches (caller falls back to aspect-key default + brand list).
 *  Returns a ClassifiedIdentifier when a known OEM or Partslink pattern is detected. */
export function classifyIdentifier(value: string): ClassifiedIdentifier | null | undefined {
    const v = value.trim().replace(/-/g, '');
    if (!v) return undefined;
    if (UPC_EAN_PATTERN.test(v)) return null;   // drop barcodes

    // Partslink: exactly 2 uppercase letters + 7 digits
    const partslink = /^([A-Z]{2})(\d{7})$/.exec(v);
    if (partslink && PARTSLINK_PREFIX_TO_MAKE[partslink[1]]) {
        return { type: 'AFTERMARKET', manufacturer: PARTSLINK_PREFIX_TO_MAKE[partslink[1]] };
    }

    for (const { pattern, manufacturer } of OEM_PATTERNS) {
        if (pattern.test(v)) return { type: 'OEM', manufacturer };
    }

    return undefined;
}

// ── HTML stripping ────────────────────────────────────────────────

const HTML_ENTITIES: Record<string, string> = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
    '&copy;': '©', '&reg;': '®', '&trade;': '™',
};

export function stripHtml(text: string): string {
    return text
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, m => HTML_ENTITIES[m] ?? ' ')
        .replace(/&#\d+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
