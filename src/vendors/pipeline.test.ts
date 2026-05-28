import { VendorPipeline } from './pipeline';
import { VendorInventoryClient } from './clients/vendorInventoryClient';
import DrizzleRecordProcessor from './recordProcessor/recordProcessor';
import type { BatchResult } from './recordProcessor/recordProcessor';
import type { Fitment, VendorRecord } from './clients/vendorRecord';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRecord(externalId: string): VendorRecord {
    return {
        part: { name: 'Bumper Cover', category: 'BUMPER_COVER' },
        identifiers: [{ type: 'INTERCHANGE', value: '12345' }],
        fitments: [],
        listing: {
            vendorListingExternalId: externalId,
            condition: 'NEW_AFTERMARKET',
            availabilityStatus: 'IN_STOCK',
            priceMinorMin: 1000,
            currency: 'USD',
        },
    };
}

function makeClient(overrides: Partial<VendorInventoryClient> = {}): VendorInventoryClient {
    return {
        vendorId: 'test-vendor',
        fetchInventoryPage: jest.fn().mockResolvedValue({
            records: [{}],
            nextCursor: undefined,
            hasMore: false,
        }),
        mapRecord: jest.fn().mockReturnValue(makeRecord('v1|111|0')),
        ...overrides,
    };
}

function makeProcessor(result: Partial<BatchResult> = {}): DrizzleRecordProcessor {
    const base: BatchResult = { succeeded: 1, failed: 0, skipped: 0, newParts: [], ...result };
    return {
        validateAndUpsert: jest.fn().mockResolvedValue(base),
        appendFitmentsToParts: jest.fn().mockResolvedValue(undefined),
    } as unknown as DrizzleRecordProcessor;
}

// ── processPage ───────────────────────────────────────────────────────────────

describe('VendorPipeline.processPage', () => {
    it('no new parts — fetchFitmentsForNewParts and appendFitmentsToParts are not called', async () => {
        const fetchFitmentsForNewParts = jest.fn();
        const client = makeClient({ fetchFitmentsForNewParts });
        const processor = makeProcessor({ newParts: [] });
        const pipeline = new VendorPipeline(client, processor);

        await pipeline.processPage();

        expect(fetchFitmentsForNewParts).not.toHaveBeenCalled();
        expect(processor.appendFitmentsToParts).not.toHaveBeenCalled();
    });

    it('new parts present — fetchFitmentsForNewParts called with externalIds; appendFitmentsToParts called with enrichments', async () => {
        const fitmentA: Fitment = { make: 'Honda', model: 'Civic', year: 2020 };
        const fitmentB: Fitment = { make: 'Honda', model: 'Accord', year: 2021 };

        const newParts: BatchResult['newParts'] = [
            { partId: 'part-1', vendorListingExternalId: 'v1|111|0' },
            { partId: 'part-2', vendorListingExternalId: 'v1|222|0' },
        ];
        const fitmentMap = new Map<string, Fitment[]>([
            ['v1|111|0', [fitmentA]],
            ['v1|222|0', [fitmentB]],
        ]);

        const fetchFitmentsForNewParts = jest.fn().mockResolvedValue(fitmentMap);
        const client = makeClient({ fetchFitmentsForNewParts });
        const processor = makeProcessor({ newParts });
        const pipeline = new VendorPipeline(client, processor);

        await pipeline.processPage();

        expect(fetchFitmentsForNewParts).toHaveBeenCalledTimes(1);
        expect(fetchFitmentsForNewParts).toHaveBeenCalledWith(['v1|111|0', 'v1|222|0']);

        expect(processor.appendFitmentsToParts).toHaveBeenCalledTimes(1);
        expect(processor.appendFitmentsToParts).toHaveBeenCalledWith([
            { partId: 'part-1', fitments: [fitmentA] },
            { partId: 'part-2', fitments: [fitmentB] },
        ]);
    });

    it('new parts present but fitmentMap returns empty arrays — appendFitmentsToParts not called', async () => {
        const newParts: BatchResult['newParts'] = [
            { partId: 'part-1', vendorListingExternalId: 'v1|111|0' },
        ];
        const fitmentMap = new Map<string, Fitment[]>([['v1|111|0', []]]);

        const fetchFitmentsForNewParts = jest.fn().mockResolvedValue(fitmentMap);
        const client = makeClient({ fetchFitmentsForNewParts });
        const processor = makeProcessor({ newParts });
        const pipeline = new VendorPipeline(client, processor);

        await pipeline.processPage();

        expect(fetchFitmentsForNewParts).toHaveBeenCalledTimes(1);
        expect(processor.appendFitmentsToParts).not.toHaveBeenCalled();
    });
});
