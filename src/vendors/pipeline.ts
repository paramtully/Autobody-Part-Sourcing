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
        const mapped = page.records.map(r => this.client.mapRecord(r));
        const result = await this.processor.validateAndUpsert(mapped, this.client.vendorId);

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
