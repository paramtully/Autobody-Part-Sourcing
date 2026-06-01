/**
 * listingWorker handler — vendor rate limits must pause the run, not fail the Lambda.
 */

import { VendorError } from '@repo/vendors';

const mocks = {
    processPage: jest.fn(),
    update: jest.fn(),
    findInProgress: jest.fn(),
    findLatest: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
};

jest.mock('@repo/db', () => ({
    db: {},
    IngestionRunRepo: jest.fn().mockImplementation(() => ({
        findInProgress: (...args: unknown[]) => mocks.findInProgress(...args),
        findLatest: (...args: unknown[]) => mocks.findLatest(...args),
        create: (...args: unknown[]) => mocks.create(...args),
        update: (...args: unknown[]) => mocks.update(...args),
    })),
    VendorRepo: jest.fn().mockImplementation(() => ({
        findById: (...args: unknown[]) => mocks.findById(...args),
    })),
}));

jest.mock('@repo/vendors', () => {
    const actual = jest.requireActual('@repo/vendors') as Record<string, unknown>;
    return {
        ...actual,
        VendorPipeline: jest.fn().mockImplementation(() => ({
            processPage: (...args: unknown[]) => mocks.processPage(...args),
        })),
        DrizzleRecordProcessor: jest.fn(),
        eBayVendorClient: jest.fn().mockImplementation((opts: { vendorId: string }) => ({
            vendorId: opts.vendorId,
            pageSize: 200,
        })),
    };
});

import { handler } from './handler.js';

const RUN_ID = '8ffb5eb6-6501-4dba-a766-2c041a27d6df';
const BASE_STATS = { processed: 0, succeeded: 0, failed: 0, skipped: 0, pagesFetched: 0 };

const lambdaCtx = { getRemainingTimeInMillis: () => 12 * 60 * 1000 };

beforeEach(() => {
    jest.clearAllMocks();
    process.env['VENDOR_ID'] = 'ebay-us';
    process.env['INGEST_INTERVAL_MS'] = '0';

    mocks.findById.mockResolvedValue({ id: 'ebay-us', name: 'eBay US' });
    mocks.findLatest.mockResolvedValue(null);
    mocks.findInProgress.mockResolvedValue({
        id: RUN_ID,
        vendorId: 'ebay-us',
        status: 'IN_PROGRESS',
        lastCursor: null,
        stats: { ...BASE_STATS },
    });
    mocks.update.mockResolvedValue(undefined);
});

describe('listingWorker handler — vendor rate limit', () => {
    it('RATE_LIMIT — marks run RATE_LIMITED and persists cursor', async () => {
        mocks.processPage.mockRejectedValue(
            new VendorError('RATE_LIMIT', 'eBay rate limit exceeded', 60_000),
        );

        await expect(handler({}, lambdaCtx)).resolves.toBeUndefined();

        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(mocks.update).toHaveBeenCalledWith(
            RUN_ID,
            expect.objectContaining({
                status: 'RATE_LIMITED',
                lastCursor: null,
                lastChunkAt: expect.any(Date),
                stats: expect.objectContaining(BASE_STATS),
            }),
        );
    });

    it('RATE_LIMITED within pause window — skips without calling vendor', async () => {
        mocks.findInProgress.mockResolvedValue(null);
        mocks.findLatest.mockResolvedValue({
            id: RUN_ID,
            vendorId: 'ebay-us',
            status: 'RATE_LIMITED',
            lastChunkAt: new Date(),
            lastCursor: 'page-2',
            stats: { ...BASE_STATS },
        });

        await expect(handler({}, lambdaCtx)).resolves.toBeUndefined();

        expect(mocks.processPage).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('AUTH_ERROR — rethrows after marking run FAILED (distinct from rate limit)', async () => {
        mocks.processPage.mockRejectedValue(
            new VendorError('AUTH_ERROR', 'Failed to authenticate with eBay'),
        );

        await expect(handler({}, lambdaCtx)).rejects.toThrow('Failed to authenticate with eBay');

        expect(mocks.update).toHaveBeenCalledWith(
            RUN_ID,
            expect.objectContaining({
                status: 'FAILED',
                errorMessage: 'Failed to authenticate with eBay',
            }),
        );
    });
});
