import { VendorInventoryClient } from "../vendorInventoryClient";
import { VendorError, VendorErrorType } from "../vendorError";
import { AvailabilityStatus, PartCondition, UnknownRawVendorRecord, VendorRecord } from "../vendorRecord";
import { eBayItemSchema, mapEbayCondition, mapEbayItemAvailability, mapEbayConstraint } from "./schema.ebay.item";
import { Buffer } from 'buffer';
import * as dotenv from 'dotenv';
dotenv.config();

interface eBayConfig {
    vendorId: string;
    apiKey: string;
    apiSecret: string;
    apiUrl: string;
    token?: string;
    tokenExpiresAt?: Date;
    inFlightToken: boolean;
    retryAfterMs?: number;
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
    };

    mapRecord(raw: UnknownRawVendorRecord): VendorRecord {
        const record = eBayItemSchema.safeParse(raw);
        if (!record.success) {
            throw new VendorError('VALIDATION_ERROR', `eBay record validation failed: ${record.error.message}`, this.config.retryAfterMs, record.error);
        }

        const item = record.data;

        // Convert price string to minor units (e.g. "$12.99" → 1299 cents)
        const priceMinorMin = item.price?.value
            ? Math.round(parseFloat(item.price.value) * 100)
            : 0;

        // Estimate ship time in hours from average estimated delivery date
        const firstShipping = item.shippingOptions?.[0];
        let estimatedShipTimeHours: number | undefined;
        if (firstShipping?.minEstimatedDeliveryDate) {
            // averages min and max estimated delivery dates
            const deliveryMs = (
                new Date(firstShipping.minEstimatedDeliveryDate).getTime() +
                new Date(firstShipping.maxEstimatedDeliveryDate ?? firstShipping.minEstimatedDeliveryDate).getTime()) /
                2 - Date.now();
            if (deliveryMs > 0) {
                estimatedShipTimeHours = Math.round(deliveryMs / (1000 * 60 * 60));
            }
        }

        const availableQty = item.estimatedAvailability?.estimatedAvailableQuantity ?? null;

        // Extract fitments from compatibilityProperties (PRODUCT,COMPATIBILITY fieldgroups).
        // The Browse API returns a flat list of {name, value} per compatible vehicle.
        const compatProps = item.compatibilityProperties ?? [];
        const getProp = (n: string) => compatProps.find(p => p.name === n)?.value;
        const make = getProp('Make');
        const model = getProp('Model');
        const year = parseInt(getProp('Year') ?? '', 10);
        const fitments = make && model && !isNaN(year)
            ? [{ make, model, year, trim: getProp('Trim'), engine: getProp('Engine'), constraint: mapEbayConstraint(item.product?.aspects) }]
            : [];

        // Prefer the MPN from product.aspects; fall back to top-level mpn, then legacyItemId.
        const mpn = item.product?.aspects?.['Manufacturer Part Number']?.[0]
            ?? item.mpn;
        const brand = item.product?.brand ?? item.brand;
        const identifiers: VendorRecord['identifiers'] = mpn
            ? [{ type: 'AFTERMARKET', value: mpn, manufacturer: brand }]
            : [{ type: 'INTERCHANGE', value: item.legacyItemId ?? item.itemId }];

        return {
            part: {
                name: item.title ?? item.itemId,
                category: item.primaryCategory?.categoryName ?? 'Auto Parts',
            },
            identifiers,
            fitments,
            listing: {
                vendorListingExternalId: item.itemId,
                sourceUrl: item.itemWebUrl,
                condition: mapEbayCondition(item.condition) as PartCondition,
                description: item.shortDescription ?? item.description,
                quantityAvailable: availableQty !== null ? availableQty : undefined,
                availabilityStatus: mapEbayItemAvailability(availableQty) as AvailabilityStatus,
                priceMinorMin,
                currency: item.price?.currency ?? 'USD',
                estimatedShipTimeHours,
                images: item.additionalImages?.map(img => ({ url: img.imageUrl })),
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

        const records = itemIds.flatMap(id => {
            const entry = detailMap.get(id);
            if (entry === null) return [];                          // 404: item gone, drop
            if (entry === undefined) return [];                    // not in map (shouldn't happen)
            if (entry.record !== null) return [entry.record];     // success: use enriched detail
            const summary = summaryById.get(id);                  // other failure: fall back to summary
            return summary ? [summary] : [];
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
                `${this.config.apiUrl}/buy/browse/v1/item/${encodeURIComponent(itemId)}?fieldgroups=PRODUCT,COMPATIBILITY`,
                { headers: { Authorization: `Bearer ${this.config.token}` } },
            );
        } catch {
            return { record: null }; // network blip — fall back to summary
        }

        if (res.status === 429 && retriesLeft > 0) {
            const retryAfter = res.headers.get('Retry-After');
            await this.sleep(retryAfter ? parseFloat(retryAfter) * 1000 : 1_000);
            return this.fetchItemDetail(itemId, retriesLeft - 1);
        }

        if (res.status === 404) {
            return null; // listing ended — caller drops the item entirely
        }

        if (!res.ok) {
            return { record: null }; // other server error — fall back to summary
        }

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
