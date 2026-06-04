import { VendorInventoryClient } from "../vendorInventoryClient";
import { VendorError, VendorErrorType } from "../vendorError";
import { normalizePartIdentifierValue } from "@repo/db";
import { AvailabilityStatus, Fitment, PartCondition, UnknownRawVendorRecord, VendorRecord } from "../vendorRecord";
import {
    eBayItemSchema, buildAspectMap, mapEbayCondition, mapEbayItemAvailability, mapEbayConstraint, mapEbayCategory,
    mapEbayPosition, parseItemWeightGrams, mapEbayCertification,
    extractVin, extractDamageType, stripHtml, classifyIdentifier,
} from "./schema.ebay.item";
import { fetchEbayItemCompatibilities } from "./tradingApi.ebay";
import { Buffer } from 'buffer';
import * as dotenv from 'dotenv';
dotenv.config();

const AUTOMAKER_BRANDS = new Set([
    'Honda', 'Toyota', 'Ford', 'GM', 'Chevrolet', 'GMC', 'Nissan', 'Mazda', 'Subaru',
    'Hyundai', 'Kia', 'BMW', 'Mercedes-Benz', 'Audi', 'Volkswagen', 'Volvo', 'Acura',
    'Lexus', 'Infiniti', 'Chrysler', 'Dodge', 'Jeep', 'Ram', 'Cadillac', 'Buick',
    'Pontiac', 'Oldsmobile', 'Saturn', 'Mitsubishi', 'Isuzu', 'Suzuki',
    'Lincoln', 'Scion', 'Tesla', 'Genesis',
]);

const AFTERMARKET_BRANDS = new Set([
    'TYC', 'Depo', 'Sherman', 'Anzo', 'Spec-D', 'Dorman', 'Replace', 'Action Crash',
    'Eagle', 'Spyder', 'CAPA', 'NSF', 'Keystone', 'LKQ', 'Evan Fischer',
]);

const JUNK_BRANDS = new Set([
    'unbranded', 'does not apply', 'generic', 'n/a', 'none',
    'aftermarket', 'oe replacement', 'oe style',
]);

const JUNK_IDENTIFIER_VALUES = new Set([
    'na', 'n/a', 'no', 'none', 'does not apply', 'unbranded', 'universal',
    'aftermarket', 'oe replacement', 'oe style',
]);

function isJunkIdentifier(value: string): boolean {
    const v = value.trim().toLowerCase();
    if (v.length < 3 || v.length > 40) return true;   // descriptions and single-char stubs
    if (JUNK_IDENTIFIER_VALUES.has(v)) return true;
    if (!/[a-z0-9]/.test(v)) return true;              // pure punctuation
    if (!/\d/.test(v)) return true;                    // real part numbers always contain a digit
    return false;
}

function cleanBrand(brand: string | undefined, sellerUsername: string | undefined): string | undefined {
    if (!brand) return undefined;
    const lower = brand.toLowerCase();
    if (JUNK_BRANDS.has(lower)) return undefined;
    if (sellerUsername && lower === sellerUsername.toLowerCase()) return undefined;
    return brand;
}

function splitAspect(value: string | undefined): string[] {
    if (!value) return [];
    return value.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

interface eBayVendorClientOptions {
    vendorId: string;       // e.g. 'ebay-us' | 'ebay-ca'
    marketplaceId: string;  // e.g. 'EBAY_US' | 'EBAY_CA'
    tradingSiteId: string;  // '100' = US Motors, '2' = eBay CA'
    pageSize?: number;      // Browse search limit per page (max 200)
}

interface eBayConfig {
    vendorId: string;
    apiKey: string;
    apiSecret: string;
    apiUrl: string;
    marketplaceId: string;
    tradingSiteId: string;
    token?: string;
    tokenExpiresAt?: Date;
    inFlightToken: boolean;
    retryAfterMs?: number;
    ruName?: string;
    refreshToken?: string;
    userToken?: string;
    userTokenExpiresAt?: Date;
}

export default class eBayVendorClient implements VendorInventoryClient {
    readonly vendorId: string;
    readonly pageSize: number;
    // Targeted body-panel sub-categories (eBay Motors category tree).
    // These drive precise inventory rather than the noisy 'auto body part' keyword search.
    // NOTE: reset any in-progress ingestion_runs rows before deploying — the offset cursor
    // no longer corresponds to the same search scope.
    // The Browse API enforces a limit of 1 category per request, so we cycle through
    // categories sequentially, encoding position as "{categoryIndex}:{offset}" in the cursor.
    // Browse API requires `q` when category_ids is a top-level (L1) category — without it, error 12001.
    private readonly TARGETED_CATEGORY_SEARCHES: ReadonlyArray<{ categoryId: string; q: string }> = [
        { categoryId: '33637', q: 'bumper' },       // Bumpers & Reinforcements
        { categoryId: '33714', q: 'fender' },       // Fenders / Panels
        { categoryId: '33710', q: 'headlight' },    // Headlight Assemblies
        { categoryId: '33642', q: 'mirror' },       // Side View Mirrors
        { categoryId: '33556', q: 'door' },         // Doors
        { categoryId: '33567', q: 'hood' },         // Hoods
    ];
    readonly config: eBayConfig;

    constructor(opts: eBayVendorClientOptions) {
        this.vendorId = opts.vendorId;
        this.pageSize = opts.pageSize ?? 200;
        this.config = {
            vendorId: opts.vendorId,
            apiKey: process.env.EBAY_API_KEY!,
            apiSecret: process.env.EBAY_API_SECRET!,
            apiUrl: process.env.EBAY_API_URL || 'https://api.ebay.com',
            marketplaceId: opts.marketplaceId,
            tradingSiteId: opts.tradingSiteId,
            inFlightToken: false,
            ruName: process.env.EBAY_RU_NAME || undefined,
            refreshToken: process.env.EBAY_USER_REFRESH_TOKEN || undefined,
        };
    }

    mapRecord(raw: UnknownRawVendorRecord): VendorRecord {
        const record = eBayItemSchema.safeParse(raw);
        if (!record.success) {
            throw new VendorError('VALIDATION_ERROR', `eBay record validation failed: ${record.error.message}`, this.config.retryAfterMs, record.error);
        }

        const item = record.data;
        const aspects = buildAspectMap(item);

        // Convert price string to minor units (e.g. "$12.99" → 1299 cents)
        const priceMinorMin = item.price?.value
            ? Math.round(parseFloat(item.price.value) * 100)
            : 0;

        // Estimate ship time in hours from average estimated delivery date
        const firstShipping = item.shippingOptions?.[0];
        let estimatedShipTimeHours: number | undefined;
        if (firstShipping?.minEstimatedDeliveryDate) {
            const deliveryMs = (
                new Date(firstShipping.minEstimatedDeliveryDate).getTime() +
                new Date(firstShipping.maxEstimatedDeliveryDate ?? firstShipping.minEstimatedDeliveryDate).getTime()) /
                2 - Date.now();
            if (deliveryMs > 0) {
                estimatedShipTimeHours = Math.round(deliveryMs / (1000 * 60 * 60));
            }
        }

        const availableQty = item.estimatedAvailabilities?.[0]?.estimatedRemainingQuantity ?? null;

        // Fitments: single-vehicle compatibilityProperties from Browse API.
        // Full fitment matrix is fetched separately via fetchFitmentsForNewParts (Trading API) for new parts only.
        const compatProps = item.compatibilityProperties ?? [];
        const getProp = (n: string) => compatProps.find(p => p.name === n)?.value;
        const make  = getProp('Make');
        const model = getProp('Model');
        const year  = parseInt(getProp('Year') ?? '', 10);
        const fitments: Fitment[] = make && model && !isNaN(year)
            ? [{ make, model, year, trim: getProp('Trim'), engine: getProp('Engine'), constraint: mapEbayConstraint(aspects) }]
            : [];

        // Brand: drop junk values so cross-refs are clean and manufacturer column is accurate.
        const rawBrand = aspects['Brand']?.[0] ?? item.brand;
        const brand = cleanBrand(rawBrand, item.seller?.username);
        const certification = mapEbayCertification(aspects);

        // Identifiers: emit own-MPN first (representative), then cross-refs.
        // Pattern classifier wins over brand field — a Texas-E-Parts listing can still carry
        // genuine Honda OEM numbers. Brand is only consulted when no pattern matches (MPN fallback).
        const identifiers: VendorRecord['identifiers'] = [];
        const seen = new Set<string>();
        const addId = (type: 'OEM' | 'AFTERMARKET' | 'INTERCHANGE', value: string, manufacturer?: string, cert?: 'CAPA' | 'NSF') => {
            const trimmed = normalizePartIdentifierValue(value);
            if (!trimmed || isJunkIdentifier(trimmed)) return;
            const key = `${type}:${trimmed}`;
            if (seen.has(key)) return;
            seen.add(key);
            identifiers.push({ type, value: trimmed, manufacturer, certification: cert });
        };

        // emit: runs classifier first; falls back to aspect-key defaults when no pattern matches.
        // Returns without calling addId when the value is a UPC/EAN barcode (null from classifier).
        const emit = (
            fallbackType: 'OEM' | 'AFTERMARKET' | 'INTERCHANGE',
            value: string,
            fallbackManufacturer?: string,
            cert?: 'CAPA' | 'NSF',
        ) => {
            const detected = classifyIdentifier(value.trim());
            if (detected === null) return;  // UPC/EAN — drop
            if (detected) {
                addId(detected.type, value, detected.manufacturer ?? fallbackManufacturer, cert);
            } else {
                addId(fallbackType, value, fallbackManufacturer, cert);
            }
        };

        // 1. Own MPN — type derived from brand identity (classifier overrides when pattern matches)
        const mpnRaw = aspects['Manufacturer Part Number']?.[0] ?? item.mpn;
        for (const mpn of splitAspect(mpnRaw)) {
            const mpnType = AUTOMAKER_BRANDS.has(brand ?? '') ? 'OEM'
                : AFTERMARKET_BRANDS.has(brand ?? '') ? 'AFTERMARKET'
                : 'INTERCHANGE';
            emit(mpnType, mpn, brand ?? undefined, certification);
        }

        // 2. Partslink cross-refs (aftermarket standard)
        for (const raw of splitAspect(aspects['Partslink Number']?.[0] ?? aspects['Part Link Number']?.[0])) {
            emit('AFTERMARKET', raw, undefined, certification);
        }

        // 3. OEM cross-refs
        for (const raw of splitAspect(aspects['OE/OEM Part Number']?.[0] ?? aspects['OE Number']?.[0])) {
            emit('OEM', raw, undefined, undefined);
        }

        // 4. Interchange cross-refs
        for (const raw of splitAspect(aspects['Interchange Part Number']?.[0])) {
            emit('INTERCHANGE', raw, undefined, undefined);
        }

        // 5. Fallback: use eBay item ID as opaque interchange reference.
        // Uses addId directly to bypass the UPC digit-count filter — eBay legacy IDs are
        // 12+ digit strings that look like barcodes but are valid identifier references.
        if (identifiers.length === 0) {
            addId('INTERCHANGE', item.legacyItemId ?? item.itemId, brand ?? undefined);
        }

        const category = mapEbayCategory(
            item.categoryPath,
            item.primaryCategory?.categoryName,
            `${aspects['Part Name']?.[0] ?? ''} ${aspects['Type']?.[0] ?? ''} ${item.title ?? ''}`,
        );
        const descText = `${item.title ?? ''} ${item.description ?? ''}`;

        let condition = mapEbayCondition(item.condition) as PartCondition;
        if (condition === 'NEW_AFTERMARKET' && identifiers[0]?.type === 'OEM') {
            condition = 'NEW_OEM';
        }

        return {
            part: {
                name: (aspects['Part Name']?.[0] ?? item.title ?? item.itemId).slice(0, 255),
                category,
                position: mapEbayPosition(
                    category,
                    [aspects['Placement on Vehicle']?.[0], aspects['Vehicle Part Location']?.[0], item.title]
                        .map(v => v?.trim())
                        .find(Boolean),
                ),
                description: stripHtml(item.shortDescription ?? item.description ?? '').slice(0, 500) || undefined,
                weightGrams: parseItemWeightGrams(aspects['Item Weight']?.[0]),
            },
            identifiers,
            fitments,
            listing: {
                vendorListingExternalId: item.itemId,
                sourceUrl: item.itemWebUrl,
                condition,
                description: item.shortDescription
                    ? stripHtml(item.shortDescription)
                    : item.description ? stripHtml(item.description).slice(0, 2000) || undefined : undefined,
                quantityAvailable: availableQty !== null ? availableQty : undefined,
                availabilityStatus: mapEbayItemAvailability(availableQty) as AvailabilityStatus,
                priceMinorMin,
                currency: item.price?.currency ?? 'USD',
                estimatedShipTimeHours,
                images: item.additionalImages?.map(img => ({ url: img.imageUrl })),
                warehouseLocation: item.itemLocation?.country
                    ? {
                        country: item.itemLocation.country,
                        stateOrProvince: item.itemLocation.stateOrProvince,
                        city: item.itemLocation.city,
                        postalCode: item.itemLocation.postalCode?.includes('*') ? undefined : item.itemLocation.postalCode,
                    }
                    : undefined,
                sourceVehicleVin: extractVin(descText),
                sourceDamageType: extractDamageType(descText),
            },
        };
    }

    async fetchInventoryPage(cursor?: string): Promise<{ records: UnknownRawVendorRecord[]; nextCursor?: string; hasMore: boolean }> {
        await this.authenticate();

        const t0 = Date.now();
        const { records: summaries, nextCursor, hasMore } = await this.fetchItemSummaries(cursor);
        console.log(`[ebay] fetched ${summaries.length} summaries in ${Date.now() - t0}ms`);

        // Build a summary fallback map for when detail fetches fail for non-404 reasons.
        const summaryById = new Map<string, UnknownRawVendorRecord>();
        for (const s of summaries) {
            const id = (s as { itemId?: string }).itemId;
            if (id) summaryById.set(id, s);
        }
        const itemIds = [...summaryById.keys()];

        // detailMap is keyed by requested itemId; null = 404 (drop), undefined key = other failure (use summary).
        const t1 = Date.now();
        const detailMap = await this.fetchItemDetailsConcurrent(itemIds);
        console.log(`[ebay] fetched ${itemIds.length} item details in ${Date.now() - t1}ms`);

        const records: UnknownRawVendorRecord[] = [];
        for (const id of itemIds) {
            const entry = detailMap.get(id);
            if (entry === null) continue;      // 404: item gone, drop
            if (entry === undefined) continue; // not in map (shouldn't happen)
            const record = entry.record !== null ? entry.record : summaryById.get(id);
            if (record) records.push(record);
        }

        return { records, nextCursor, hasMore };
    }

    /**
     * Decode a compound cursor of the form "{categoryIndex}:{offset}" (or undefined for start).
     * Returns the category index and numeric offset within that category.
     */
    private decodeCursor(cursor?: string): { catIdx: number; offset: number } {
        if (!cursor) return { catIdx: 0, offset: 0 };
        const sep = cursor.indexOf(':');
        if (sep === -1) {
            // Legacy plain-offset cursor — treat as first category at that offset.
            return { catIdx: 0, offset: Number(cursor) };
        }
        return { catIdx: Number(cursor.slice(0, sep)), offset: Number(cursor.slice(sep + 1)) };
    }

    private async fetchItemSummaries(cursor?: string): Promise<{ records: UnknownRawVendorRecord[]; nextCursor?: string; hasMore: boolean }> {
        // Browse API allows at most 1 category_ids value per request.
        // We cycle through TARGETED_CATEGORY_IDS sequentially, encoding position in the cursor.
        const { catIdx, offset } = this.decodeCursor(cursor);
        const search = this.TARGETED_CATEGORY_SEARCHES[catIdx];
        if (!search) {
            return { records: [], nextCursor: undefined, hasMore: false };
        }

        let res: Response;
        try {
            const params = new URLSearchParams({
                q: search.q,
                category_ids: search.categoryId,
                limit: String(this.pageSize),
                offset: String(offset),
            });
            const url: string = `${this.config.apiUrl}/buy/browse/v1/item_summary/search?${params}`;
            res = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'X-EBAY-C-MARKETPLACE-ID': this.config.marketplaceId,
                },
                signal: AbortSignal.timeout(30_000),
            });
        } catch (error) {
            throw new VendorError('NETWORK_ERROR', `eBay network error: ${error instanceof Error ? error.message : String(error)}`, this.config.retryAfterMs, error);
        }

        if (!res.ok) {
            await this.throwVendorError(res);
        }

        const body = await res.json();
        const records = (body.itemSummaries ?? [])
            .map((item: unknown) => eBayItemSchema.safeParse(item))
            .filter((r: { success: boolean }) => r.success)
            .map((r: { data: unknown }) => r.data as UnknownRawVendorRecord);

        if (records.length === 0 && !body.next && catIdx >= this.TARGETED_CATEGORY_SEARCHES.length - 1) {
            // Last category is also empty — nothing left to ingest.
            throw new VendorError('INVALID_REQUEST', 'No data found in eBay response', this.config.retryAfterMs, new Error('No data found in eBay response'));
        }

        const pageLimit = Number(body.limit ?? this.pageSize);
        const currentOffset = Number(body.offset ?? offset);
        const categoryHasMore: boolean = !!body.next;

        let nextCursor: string | undefined;
        let hasMore: boolean;

        if (categoryHasMore) {
            // More pages within the same category.
            nextCursor = `${catIdx}:${currentOffset + pageLimit}`;
            hasMore = true;
        } else {
            // Current category exhausted — advance to next category if one exists.
            const nextCatIdx = catIdx + 1;
            if (nextCatIdx < this.TARGETED_CATEGORY_SEARCHES.length) {
                nextCursor = `${nextCatIdx}:0`;
                hasMore = true;
            } else {
                nextCursor = undefined;
                hasMore = false;
            }
        }

        return { records, nextCursor, hasMore };
    }

    /**
     * Fetch item details for a list of item IDs concurrently.
     * @param itemIds - The list of item IDs to fetch details for.
     * @param concurrency - The number of concurrent requests to make.
     * @returns The list of item details.
     */
    private async fetchItemDetailsConcurrent(
        itemIds: string[],
        concurrency = 20,
    ): Promise<Map<string, { record: UnknownRawVendorRecord | null } | null>> {
        const resultMap = new Map<string, { record: UnknownRawVendorRecord | null } | null>();
        const queue = [...itemIds];

        const worker = async () => {
            while (queue.length > 0) {
                const id = queue.shift()!;
                resultMap.set(id, await this.fetchItemDetail(id));
            }
        };

        await Promise.all(Array.from({ length: concurrency }, worker));
        return resultMap;
    }

    /**
     * Fetch full vehicle compatibility matrices from the Trading API for a list of new parts,
     * keyed by vendorListingExternalId. Only called after dedup so Trading API quota is spent
     * only on parts not yet in the database.
     *
     * Parses the legacy numeric ID from the modern Browse API format `v1|<legacyId>|<variation>`.
     * Requires EBAY_USER_REFRESH_TOKEN — returns an empty map when not configured.
     */
    async fetchFitmentsForNewParts(
        vendorListingExternalIds: string[],
        concurrency = 20,
    ): Promise<Map<string, Fitment[]>> {
        const userToken = await this.authenticateUser();
        if (!userToken) {
            console.warn('[ebay] skipping Trading API enrichment — EBAY_USER_REFRESH_TOKEN not set');
            return new Map();
        }

        // Map legacy numeric ID → external ID so we can re-key results by external ID.
        const legacyToExternal = new Map<string, string>();
        for (const ext of vendorListingExternalIds) {
            const legacy = ext.includes('|') ? ext.split('|')[1] : ext;
            if (legacy) legacyToExternal.set(legacy, ext);
        }

        const byLegacy = new Map<string, Fitment[]>();
        const queue = [...legacyToExternal.keys()];
        const worker = async () => {
            while (queue.length > 0) {
                const id = queue.shift()!;
                byLegacy.set(id, await fetchEbayItemCompatibilities(id, userToken, this.config.apiUrl, this.config.tradingSiteId));
            }
        };
        await Promise.all(Array.from({ length: concurrency }, worker));

        const result = new Map<string, Fitment[]>();
        for (const [legacy, fits] of byLegacy) {
            const ext = legacyToExternal.get(legacy);
            if (ext) result.set(ext, fits);
        }
        return result;
    }

    /**
     * Fetch item details for a single item ID.
     * @param itemId - The item ID to fetch details for.
     * @param retriesLeft - The number of retries to make.
     * @returns The item details.
     */
    private async fetchItemDetail(
        itemId: string,
        retriesLeft = 3,
    ): Promise<{ record: UnknownRawVendorRecord | null } | null> {
        let res: Response;
        try {
            res = await fetch(
                `${this.config.apiUrl}/buy/browse/v1/item/${encodeURIComponent(itemId)}?fieldgroups=PRODUCT`,
                {
                    headers: {
                        Authorization: `Bearer ${this.config.token}`,
                        'X-EBAY-C-MARKETPLACE-ID': this.config.marketplaceId,
                    },
                    signal: AbortSignal.timeout(30_000),
                },
            );
        } catch {
            return { record: null }; // network blip or timeout — fall back to summary
        }

        if (res.status === 429 && retriesLeft > 0) {
            const retryAfter = res.headers.get('Retry-After');
            await this.sleep(retryAfter ? parseFloat(retryAfter) * 1000 : 1_000);
            return this.fetchItemDetail(itemId, retriesLeft - 1);
        }

        if (res.status === 404) {
            return null; // listing ended — caller drops the item entirely
        }

        if (!res.ok) return { record: null };

        const body = await res.json();
        const parsed = eBayItemSchema.safeParse(body);
        return { record: parsed.success ? (parsed.data as UnknownRawVendorRecord) : null };
    }

    async getAuthStatus(): Promise<{ valid: boolean; expiresAt?: Date }> {
        if (await this.authenticate()) {
            return { valid: true, expiresAt: this.config.tokenExpiresAt };
        } else {
            return { valid: false, expiresAt: undefined };
        }
    }

    /**
     * Mint (or reuse cached) user access token by exchanging the stored refresh token.
     * Returns undefined when EBAY_USER_REFRESH_TOKEN is not set — callers should
     * treat a missing user token as "skip Trading API enrichment".
     */
    public async authenticateUser(): Promise<string | undefined> {
        if (!this.config.refreshToken) return undefined;
        if (this.config.userToken && this.config.userTokenExpiresAt && this.config.userTokenExpiresAt > new Date()) {
            return this.config.userToken;
        }
        let res: Response;
        try {
            res = await fetch(`${this.config.apiUrl}/identity/v1/oauth2/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64')}`,
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: this.config.refreshToken,
                    scope: 'https://api.ebay.com/oauth/api_scope',
                }),
                signal: AbortSignal.timeout(15_000),
            });
        } catch (error) {
            console.warn(`[ebay] user-token refresh network error: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
        if (!res.ok) {
            console.warn(`[ebay] user-token refresh failed (${res.status}): ${await res.text()}`);
            return undefined;
        }
        const data = await res.json();
        this.config.userToken = data.access_token;
        this.config.userTokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);
        return this.config.userToken;
    }

    /**
     * Authenticate with eBay; sets the token and token expires at in the config.
     * @param i - Number of retries to attempt.
     * @returns success boolean
     */
    private async authenticate(i: number = 5): Promise<boolean> {
        if (this.config.token && this.config.tokenExpiresAt && this.config.tokenExpiresAt > new Date()) {
            return Promise.resolve(true);
        } else if (i > 0 && this.config.inFlightToken) {
            this.sleep(200);
            return this.authenticate(i - 1);
        } else if (i < 0) {
            return Promise.reject(new VendorError('AUTH_ERROR', 'Failed to authenticate with eBay', this.config.retryAfterMs, new Error('Max retries reached')));
        }

        let res: Response;
        try {
            this.config.inFlightToken = true;
            const url: string = `${this.config.apiUrl}/identity/v1/oauth2/token`;
            res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64')}`,
                },
                body: new URLSearchParams({
                    grant_type: 'client_credentials',
                    scope: "https://api.ebay.com/oauth/api_scope",
                }),
                signal: AbortSignal.timeout(15_000),
            });
        } catch (error) {
            this.config.inFlightToken = false;
            throw new VendorError('AUTH_ERROR', `Failed to authenticate with eBay: ${error instanceof Error ? error.message : String(error)}`, this.config.retryAfterMs, error);
        } finally {
            this.config.inFlightToken = false;
        }

        if (!res.ok) {
            throw new VendorError('AUTH_ERROR', `Failed to authenticate with eBay: ${res.statusText}`, this.config.retryAfterMs, new Error(await res.text()));
        }

        const data = await res.json();
        this.config.token = data.access_token;
        this.config.tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);
        return true;
    }



    private async throwVendorError(res: Response): Promise<never> {
        let errorType: VendorErrorType;
        let retryAfterMs: number | undefined;

        if (res.status === 429) {
            errorType = 'RATE_LIMIT';
            const retryAfter = res.headers.get('Retry-After');
            if (retryAfter) {
                retryAfterMs = parseFloat(retryAfter) * 1000;
            }
        } else if (res.status === 401 || res.status === 403) {
            errorType = 'AUTH_ERROR';
        } else if (res.status === 400 || res.status === 404 || res.status === 409 || res.status === 422) {
            errorType = 'INVALID_REQUEST';
        } else if (res.status >= 500) {
            errorType = 'SERVER_ERROR';
        } else {
            errorType = 'SERVER_ERROR';
        }

        const rawBody = await res.text();
        throw new VendorError(errorType, `eBay API returned HTTP ${res.status}: ${rawBody.substring(0, 200)}`, retryAfterMs, res);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }



}
