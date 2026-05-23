import { VendorInventoryClient } from "../vendorInventoryClient";
import { VendorError, VendorErrorType } from "../vendorError";
import { AvailabilityStatus, PartCondition, UnknownRawVendorRecord, VendorRecord } from "../vendorRecord";
import {
    eBayItemSchema, buildAspectMap, mapEbayCondition, mapEbayItemAvailability, mapEbayConstraint, mapEbayCategory,
    mapEbayPosition, parseItemWeightGrams, mapEbayCertification,
    extractVin, extractDamageType, stripHtml,
} from "./schema.ebay.item";
import { fetchEbayItemCompatibilities } from "./tradingApi";
import { Buffer } from 'buffer';
import * as dotenv from 'dotenv';
dotenv.config();

const AUTOMAKER_BRANDS = new Set([
    'Honda', 'Toyota', 'Ford', 'GM', 'Chevrolet', 'GMC', 'Nissan', 'Mazda', 'Subaru',
    'Hyundai', 'Kia', 'BMW', 'Mercedes-Benz', 'Audi', 'Volkswagen', 'Volvo', 'Acura',
    'Lexus', 'Infiniti', 'Chrysler', 'Dodge', 'Jeep', 'Ram', 'Cadillac', 'Buick',
    'Pontiac', 'Oldsmobile', 'Saturn', 'Mitsubishi', 'Isuzu', 'Suzuki',
]);

const AFTERMARKET_BRANDS = new Set([
    'TYC', 'Depo', 'Sherman', 'Anzo', 'Spec-D', 'Dorman', 'Replace', 'Action Crash',
    'Eagle', 'Spyder', 'CAPA', 'NSF', 'Keystone', 'LKQ', 'Evan Fischer',
]);

const JUNK_BRANDS = new Set(['unbranded', 'does not apply', 'generic', 'n/a', 'none']);

function cleanBrand(brand: string | undefined, sellerUsername: string | undefined): string | undefined {
    if (!brand) return undefined;
    const lower = brand.toLowerCase();
    if (JUNK_BRANDS.has(lower)) return undefined;
    if (sellerUsername && lower === sellerUsername.toLowerCase()) return undefined;
    return brand;
}

function splitAspect(value: string | undefined): string[] {
    if (!value) return [];
    return value.split(',').map(s => s.trim()).filter(Boolean);
}

interface eBayConfig {
    vendorId: string;
    apiKey: string;
    apiSecret: string;
    apiUrl: string;
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
    readonly vendorId = 'ebay';
    private readonly DEFAULT_PAGE_SIZE = 200;
    private readonly MOTORS_CATEGORY_ID = '6028';           //Motors → Parts & Accessories
    private readonly DEFAULT_SEARCH_QUERY = 'auto body part';
    readonly config: eBayConfig = {
        vendorId: this.vendorId,
        apiKey: process.env.EBAY_API_KEY!,
        apiSecret: process.env.EBAY_API_SECRET!,
        apiUrl: process.env.EBAY_API_URL! || 'https://api.ebay.com',
        inFlightToken: false,
        ruName: process.env.EBAY_RU_NAME || undefined,
        refreshToken: process.env.EBAY_USER_REFRESH_TOKEN || undefined,
    };

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

        // Fitments: prefer Trading API full matrix (_fitments), fall back to single-vehicle compatibilityProperties.
        const tradingFitments = item._fitments;
        let fitments: VendorRecord['fitments'];
        if (tradingFitments && tradingFitments.length > 0) {
            const constraint = mapEbayConstraint(aspects);
            fitments = tradingFitments.map(f => ({ ...f, constraint }));
        } else {
            const compatProps = item.compatibilityProperties ?? [];
            const getProp = (n: string) => compatProps.find(p => p.name === n)?.value;
            const make  = getProp('Make');
            const model = getProp('Model');
            const year  = parseInt(getProp('Year') ?? '', 10);
            fitments = make && model && !isNaN(year)
                ? [{ make, model, year, trim: getProp('Trim'), engine: getProp('Engine'), constraint: mapEbayConstraint(aspects) }]
                : [];
        }

        // Brand: drop junk values so cross-refs are clean and manufacturer column is accurate.
        const rawBrand = aspects['Brand']?.[0] ?? item.brand;
        const brand = cleanBrand(rawBrand, item.seller?.username);
        const certification = mapEbayCertification(aspects);

        // Identifiers: emit own-MPN first (representative), then cross-refs.
        // Own-MPN gets manufacturer: brand. Cross-refs get manufacturer: undefined —
        // a Honda OEM number is Honda's number, not the aftermarket seller's.
        const identifiers: VendorRecord['identifiers'] = [];
        const seen = new Set<string>();
        const addId = (type: 'OEM' | 'AFTERMARKET' | 'INTERCHANGE', value: string, manufacturer?: string, cert?: 'CAPA' | 'NSF') => {
            const key = `${type}:${value.trim()}`;
            if (seen.has(key) || !value.trim()) return;
            seen.add(key);
            identifiers.push({ type, value: value.trim(), manufacturer, certification: cert });
        };

        // 1. Own MPN — representative; type derived from brand identity
        const mpn = aspects['Manufacturer Part Number']?.[0] ?? item.mpn;
        if (mpn) {
            const mpnType = AUTOMAKER_BRANDS.has(brand ?? '') ? 'OEM'
                : AFTERMARKET_BRANDS.has(brand ?? '') ? 'AFTERMARKET'
                : 'INTERCHANGE';
            addId(mpnType, mpn, brand ?? undefined, certification);
        }

        // 2. Partslink cross-refs (aftermarket standard)
        for (const raw of splitAspect(aspects['Partslink Number']?.[0] ?? aspects['Part Link Number']?.[0])) {
            addId('AFTERMARKET', raw, undefined, certification);
        }

        // 3. OEM cross-refs
        for (const raw of splitAspect(aspects['OE/OEM Part Number']?.[0] ?? aspects['OE Number']?.[0])) {
            addId('OEM', raw, undefined, undefined);
        }

        // 4. Fallback: use eBay item ID as opaque interchange reference
        if (identifiers.length === 0) {
            addId('INTERCHANGE', item.legacyItemId ?? item.itemId, brand ?? undefined);
        }

        const category = mapEbayCategory(item.categoryPath, item.primaryCategory?.categoryName);
        const descText = `${item.title ?? ''} ${item.description ?? ''}`;

        return {
            part: {
                name: aspects['Part Name']?.[0] ?? (item.title ?? item.itemId).slice(0, 80),
                category,
                position: mapEbayPosition(category, aspects['Placement on Vehicle']?.[0]),
                description: stripHtml(item.shortDescription ?? item.description ?? '').slice(0, 500) || undefined,
                weightGrams: parseItemWeightGrams(aspects['Item Weight']?.[0]),
            },
            identifiers,
            fitments,
            listing: {
                vendorListingExternalId: item.itemId,
                sourceUrl: item.itemWebUrl,
                condition: mapEbayCondition(item.condition) as PartCondition,
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
                    ? { country: item.itemLocation.country, stateOrProvince: item.itemLocation.stateOrProvince, city: item.itemLocation.city, postalCode: item.itemLocation.postalCode }
                    : undefined,
                sourceVehicleVin: extractVin(descText),
                sourceDamageType: extractDamageType(descText),
            },
        };
    }

    async fetchInventoryPage(cursor?: string): Promise<{ records: UnknownRawVendorRecord[]; nextCursor?: string; hasMore: boolean }> {
        await this.authenticate();

        const { records: summaries, nextCursor, hasMore } = await this.fetchItemSummaries(cursor);

        // Build a summary fallback map for when detail fetches fail for non-404 reasons.
        const summaryById = new Map<string, UnknownRawVendorRecord>();
        for (const s of summaries) {
            const id = (s as { itemId?: string }).itemId;
            if (id) summaryById.set(id, s);
        }
        const itemIds = [...summaryById.keys()];

        // detailMap is keyed by requested itemId; null = 404 (drop), undefined key = other failure (use summary).
        const detailMap = await this.fetchItemDetailsConcurrent(itemIds);

        // Build enriched records first, collecting legacyItemIds for the Trading API call.
        const enrichedRecords: Array<{ id: string; record: UnknownRawVendorRecord; legacyItemId?: string }> = [];
        for (const id of itemIds) {
            const entry = detailMap.get(id);
            if (entry === null) continue;                          // 404: item gone, drop
            if (entry === undefined) continue;                     // not in map (shouldn't happen)
            const record = entry.record !== null ? entry.record : summaryById.get(id);
            if (!record) continue;
            const legacyItemId = (record as { legacyItemId?: string }).legacyItemId;
            enrichedRecords.push({ id, record, legacyItemId });
        }

        // Fetch full compatibility matrices from Trading API for all items concurrently.
        // Skip in sandbox — sandbox OAuth tokens are rejected by the production Trading API.
        const isSandbox = this.config.apiUrl.includes('sandbox');
        const compatMap = isSandbox ? new Map() : await this.fetchItemCompatibilitiesConcurrent(
            enrichedRecords.flatMap(r => r.legacyItemId ? [r.legacyItemId] : []),
        );

        const records = enrichedRecords.map(({ record, legacyItemId }) => {
            const fitments = legacyItemId ? compatMap.get(legacyItemId) : undefined;
            if (fitments && fitments.length > 0) {
                return { ...(record as object), _fitments: fitments } as UnknownRawVendorRecord;
            }
            return record;
        });

        return { records, nextCursor, hasMore };
    }

    /**
     * Fetch item summaries from eBay.
     * @param cursor - The cursor to use for pagination.
     * @returns The item summaries and pagination information.
     */
    private async fetchItemSummaries(cursor?: string): Promise<{ records: UnknownRawVendorRecord[]; nextCursor?: string; hasMore: boolean }> {
        let res: Response;
        try {
            const params = new URLSearchParams({
                q: this.DEFAULT_SEARCH_QUERY,
                category_ids: this.MOTORS_CATEGORY_ID,
                limit: this.DEFAULT_PAGE_SIZE.toString(),
                offset: cursor ?? '0',
            });
            const url: string = `${this.config.apiUrl}/buy/browse/v1/item_summary/search?${params}`;
            res = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
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

        if (records.length === 0) {
            throw new VendorError('INVALID_REQUEST', 'No data found in eBay response', this.config.retryAfterMs, new Error('No data found in eBay response'));
        }

        const limit = Number(body.limit ?? 50)
        const offset = Number(body.offset ?? 0)
        const hasMore: boolean = body.next ? true : false;
        const nextCursor = hasMore ? String(offset + limit) : undefined

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
        concurrency = 5,
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
     * Fetch full vehicle compatibility matrices from the Trading API for a list of legacy item IDs.
     * Requires a user access token (Authorization Code flow) — skipped with a warning when
     * EBAY_USER_REFRESH_TOKEN is not configured.
     */
    private async fetchItemCompatibilitiesConcurrent(
        legacyItemIds: string[],
        concurrency = 5,
    ): Promise<Map<string, Awaited<ReturnType<typeof fetchEbayItemCompatibilities>>>> {
        const userToken = await this.authenticateUser();
        if (!userToken) {
            console.warn('[ebay] skipping Trading API enrichment — EBAY_USER_REFRESH_TOKEN not set');
            return new Map();
        }
        const resultMap = new Map<string, Awaited<ReturnType<typeof fetchEbayItemCompatibilities>>>();
        const queue = [...legacyItemIds];
        const worker = async () => {
            while (queue.length > 0) {
                const id = queue.shift()!;
                resultMap.set(id, await fetchEbayItemCompatibilities(id, userToken, this.config.apiUrl));
            }
        };
        await Promise.all(Array.from({ length: concurrency }, worker));
        return resultMap;
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
                { headers: { Authorization: `Bearer ${this.config.token}` }, signal: AbortSignal.timeout(30_000) },
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
