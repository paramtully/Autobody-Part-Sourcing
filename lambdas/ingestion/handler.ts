import type { Context } from 'aws-lambda';
import { db, IngestionRunRepo, ListingRepo } from '@repo/db';
import type { IngestionStats } from '@repo/db';
import { VendorPipeline } from '../../src/vendors/pipeline';
import DrizzleRecordProcessor from '../../src/vendors/recordProcessor/recordProcessor';
import { LKQVendorClient } from '../../src/vendors/clients/lkq';
import { eBayVendorClient } from '../../src/vendors/clients/ebay';

const BUFFER_MS = 30_000;

const runRepo = new IngestionRunRepo(db);
const listingRepo = new ListingRepo(db);

const vendorRegistry: Record<string, { pipeline: VendorPipeline }> = {
    // lkq:  { pipeline: new VendorPipeline(new LKQVendorClient(),  new DrizzleRecordProcessor()) },
    ebay: { pipeline: new VendorPipeline(new eBayVendorClient(), new DrizzleRecordProcessor()) },
};

type IngestionEvent = { vendorId: string };

export async function handler(event: IngestionEvent, context: Context): Promise<void> {
    const vendor = vendorRegistry[event.vendorId];
    if (!vendor) throw new Error(`Unknown vendor: ${event.vendorId}`);

    const run = (await runRepo.findInProgress(event.vendorId))
        ?? (await runRepo.create(event.vendorId));

    const stats: IngestionStats = (run.stats as IngestionStats) ?? {
        processed: 0, succeeded: 0, failed: 0, skipped: 0, pagesFetched: 0,
    };
    let cursor = run.lastCursor ?? undefined;

    try {
        while (context.getRemainingTimeInMillis() > BUFFER_MS) {
            const { result, nextCursor, hasMore } = await vendor.pipeline.processPage(cursor);

            stats.processed += result.succeeded + result.failed + result.skipped;
            stats.succeeded += result.succeeded;
            stats.failed   += result.failed;
            stats.skipped  += result.skipped;
            stats.pagesFetched++;
            cursor = nextCursor;

            await runRepo.update(run.id, { lastCursor: cursor ?? null, lastChunkAt: new Date(), stats });

            if (!hasMore) {
                await runRepo.update(run.id, { status: 'COMPLETED', completedAt: new Date(), stats });
                await listingRepo.markStaleInactive(event.vendorId, run.startedAt);
                return;
            }
        }
    } catch (e) {
        await runRepo.update(run.id, {
            status: 'FAILED',
            errorMessage: e instanceof Error ? e.message : String(e),
            stats,
        });
        throw e;
    }
}
