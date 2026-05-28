import { VendorInventoryClient } from './clients/vendorInventoryClient';
import DrizzleRecordProcessor, { BatchResult } from './recordProcessor/recordProcessor';
import { RetryableVendorClient } from './retry/retryableVendorClient';

export interface PageResult {
    result: BatchResult;
    nextCursor?: string;
    hasMore: boolean;
}

export class VendorPipeline {
    constructor(
        private readonly client: VendorInventoryClient,
        private readonly processor: DrizzleRecordProcessor,
    ) {
        this.client = new RetryableVendorClient(client, {
            maxAttempts: 3,
            baseDelay: 1000,
            maxDelay: 30000,
        });
    }

    async processPage(cursor?: string): Promise<PageResult> {
        if (!this.client.fetchInventoryPage) {
            throw new Error(`Vendor ${this.client.vendorId} does not support paginated fetching`);
        }

        const page = await this.client.fetchInventoryPage(cursor);
        const mapped = page.records.map(r => ({ ...this.client.mapRecord(r), rawPayload: r }));
        const result = await this.processor.validateAndUpsert(mapped, this.client.vendorId);

        if (result.newParts.length > 0 && this.client.fetchFitmentsForNewParts) {
            const externalIds = result.newParts.map(p => p.vendorListingExternalId);
            const fitmentMap = await this.client.fetchFitmentsForNewParts(externalIds);
            const enrichments = result.newParts.flatMap(p => {
                const pFitments = fitmentMap.get(p.vendorListingExternalId) ?? [];
                return pFitments.length > 0 ? [{ partId: p.partId, fitments: pFitments }] : [];
            });
            if (enrichments.length > 0) {
                await this.processor.appendFitmentsToParts(enrichments);
            }
        }

        return { result, nextCursor: page.nextCursor, hasMore: page.hasMore };
    }

    async runAll(startCursor?: string): Promise<void> {
        let cursor = startCursor;
        let hasMore = true;

        while (hasMore) {
            const page = await this.processPage(cursor);
            cursor = page.nextCursor;
            hasMore = page.hasMore;
        }
    }
}
