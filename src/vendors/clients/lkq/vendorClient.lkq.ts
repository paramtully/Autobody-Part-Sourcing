import { createHmac } from "crypto";
import { UnknownRawVendorRecord, VendorClient } from "../vendorClient";
import { lkqPageSchema } from "./schema.lkq";
import { VendorError, VendorErrorType } from "../vendorError";
import * as dotenv from 'dotenv';
dotenv.config();
/**
 * LKQ Corporation inventory client.
 *
 * Implements VendorInventoryClient for LKQ's REST API.
 * 
 * Fetches recycled and aftermarket parts from LKQ's REST API.
 *
 * Integration profile:
 * - Auth: API Key + HMAC-SHA256 signature
 * - Pagination: Cursor-based, up to 500 records per page
 * - Rate limit: ~200 req/min, returns Retry-After header on 429
 * - Key behavior: Returns 200 OK with empty listings[] for discontinued parts
 * - Inactive signal: Listings disappear without explicit deactivation
 * - NOTE: unsure if supports lookup by part number (currently not implemented)
 *
 * Responsibilities (per VendorInventoryClient contract):
 * - Fetch and paginate inventory data
 * - Handle authentication (HMAC signing)
 * - Handle vendor-specific error responses
 * - Normalize transport-level data only (HTTP -> JSON)
 * */

interface LKQConfig {
    vendorId: string;
    baseUrl: string;
    apiKey: string;
    apiSecret: string;
    retryAfterMs?: number;
}

export class LKQVendorClient implements VendorClient {
    public readonly vendorId = 'lkq';
    private readonly DEFAULT_PAGE_SIZE = 500;
    private readonly config: LKQConfig = {
        vendorId: this.vendorId,
        baseUrl: process.env.LKQ_BASE_URL ?? 'https://api.lkqcorp.com/v1/inventory',
        apiKey: process.env.LKQ_API_KEY!,
        apiSecret: process.env.LKQ_API_SECRET!,
        retryAfterMs: 300,
    };

    async fetchInventoryPage(cursor?: string): Promise<{
        records: UnknownRawVendorRecord[];
        nextCursor?: string;
        hasMore: boolean;
    }> {
        const timestamp = Date.now().toString();
        const queryString = `cursor=${encodeURIComponent(cursor ?? '')}&limit=${this.DEFAULT_PAGE_SIZE}`;
        const signature = this.computeHmac(timestamp, queryString);

        let res: Response;
        try {
            const url = `${this.config.baseUrl}/listings?${queryString}`;
            res = await fetch(url, {
                method: 'GET',
                headers: {
                    'X-Api-Key': this.config.apiKey,
                    'X-Timestamp': timestamp,
                    'X-Signature': signature,
                    'Accept': 'application/json',
                },
            });
        } catch (e) {
            throw new VendorError('NETWORK_ERROR', `LKQ network error: ${e instanceof Error ? e.message : String(e)}`, this.config.retryAfterMs, e);
        }

        if (!res.ok) {
            throw this.throwVendorError(res);
        }

        const body = await res.json();
        const parsed = lkqPageSchema.safeParse(body);
        if (!parsed.success) {
            throw new VendorError('VALIDATION_ERROR', `LKQ response validation failed: ${parsed.error.message}`, this.config.retryAfterMs, parsed.error);
        }

        return {
            records: parsed.data.listings as UnknownRawVendorRecord[],
            nextCursor: parsed.data.nextCursor,
            hasMore: parsed.data.hasMore,
        };
    }

    /**
   * Throw a structured VendorClientError for non-200 responses.
   *
   * Error classification:
   * - 429 -> RATE_LIMIT (retryable)
   * - 401/403 -> AUTH_ERROR (non-retryable)
   * - 400 -> INVALID_REQUEST (non-retryable)
   * - 5xx -> SERVER_ERROR (retryable)
   */
    private async throwVendorError(res: Response): Promise<never> {
        let errorType: VendorErrorType;
        if (res.status === 429) {
          errorType = 'RATE_LIMIT';
        } else if (res.status === 401 || res.status === 403) {
          errorType = 'AUTH_ERROR';
        } else if (res.status === 400) {
          errorType = 'INVALID_REQUEST';
        } else if (res.status >= 500) {
          errorType = 'SERVER_ERROR';
        } else {
          errorType = 'SERVER_ERROR';
        }
        const rawBody = await res.text();
        throw new VendorError(errorType, `LKQ API returned HTTP ${res.status}: ${rawBody.substring(0, 200)}`, undefined, res);
    }

    private computeHmac(timestamp: string, body: string): string {
        return createHmac('sha256', this.config.apiSecret)
          .update(timestamp + body)
          .digest('hex');
    }
}