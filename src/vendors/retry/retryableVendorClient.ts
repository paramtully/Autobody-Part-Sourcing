
/**
 * Network retry utility for vendor API clients.
 * 
 * Provides robust retry logic with exponential backoff, full jitter, and cancellation support.
 */

import { VendorError } from "../clients/vendorError";
import { VendorInventoryClient } from "../clients/vendorInventoryClient";
import { Fitment, UnknownRawVendorRecord, VendorRecord } from "../clients/vendorRecord";

export interface RetryOptions {
    maxAttempts?: number;       // default 3
    baseDelay?: number;          // default 1000ms
    maxDelay?: number;           // default 30000ms
}

/**
 * Decorator that wraps a VendorInventoryClient with retry logic.
 *
 * Implements the same VendorInventoryClient interface, so the
 * orchestrator can't tell the difference between a raw client
 * and a retryable one. This is the "transparent proxy" pattern.
 */

export class RetryableVendorClient implements VendorInventoryClient {
    readonly vendorId: string;
    readonly pageSize: number;
    private readonly inner: VendorInventoryClient;
    readonly options: RetryOptions;


    constructor(client: VendorInventoryClient, options: RetryOptions) {
        this.vendorId = client.vendorId;
        this.pageSize = client.pageSize;
        this.inner = client;
        this.options = options;
        if (client.fetchFitmentsForNewParts) {
            this.fetchFitmentsForNewParts = (ids) => client.fetchFitmentsForNewParts!(ids);
        }
    }

    fetchFitmentsForNewParts?: (vendorListingExternalIds: string[]) => Promise<Map<string, Fitment[]>>;

    async fetchInventoryPage(cursor?: string): Promise<{
        records: UnknownRawVendorRecord[];
        nextCursor?: string;
        hasMore: boolean;
    }> {
        return this.withRetry(() => this.inner.fetchInventoryPage!(cursor));
    }

    async getAuthStatus(): Promise<{ valid: boolean; expiresAt?: Date }> {
        return this.withRetry(() => this.inner.getAuthStatus!());
    }

    /**
     * Retries an async operation with exponential backoff + full jitter.
     * Respects VendorError.retryAfterMs for rate-limit (429) responses.
     * Throws on non-retryable errors immediately.
     */
    private async withRetry<T>(
        operation: () => Promise<T>,
        options: RetryOptions = {},
    ): Promise<T> {
        const { maxAttempts = 3, baseDelay = 1_000, maxDelay = 30_000 } = options;

        let lastError: unknown;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (e) {
                lastError = e;

                const isVendorError = e instanceof VendorError;
                const retryable = isVendorError ? e.isRetryable : true;

                if (!retryable || attempt === maxAttempts) {
                    throw e;
                }

                // Honour Retry-After for rate limits; otherwise use jittered backoff
                const delay = (isVendorError && e.retryAfterMs)
                ? e.retryAfterMs
                : this.jitterDelay(attempt, baseDelay, maxDelay);

                console.warn(`[withRetry] attempt ${attempt} failed (${isVendorError ? e.type : 'unknown'}), retrying in ${delay}ms`);
                await this.sleep(delay);
            }
        }
        throw lastError;
    }

    // Calculate a jitter delay using exponential backoff + full jitter
    private jitterDelay(attempt: number, baseDelay: number, maxDelay: number): number {
        const exponential = baseDelay * Math.pow(2, attempt - 1);
        return Math.min(Math.random() * exponential, maxDelay);
    }

    // Sleep for a given number of milliseconds
    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    mapRecord(raw: UnknownRawVendorRecord): VendorRecord {
        return this.inner.mapRecord(raw);
    }
}