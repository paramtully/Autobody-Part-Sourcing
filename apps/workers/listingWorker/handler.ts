import 'dotenv/config';
import { db, IngestionRunRepo, VendorRepo } from '@repo/db';
import type { IngestionStats } from '@repo/db';
import { VendorPipeline, DrizzleRecordProcessor, LKQVendorClient, eBayVendorClient } from '@repo/vendors';
import type { PageResult, VendorInventoryClient } from '@repo/vendors';

// vendorId is the single source of truth — the key is derived from the client, not hardcoded separately
const ALL_CLIENTS: VendorInventoryClient[] = [
    // new LKQVendorClient(),
    new eBayVendorClient(),
];
const CLIENTS: Record<string, VendorInventoryClient> = Object.fromEntries(
    ALL_CLIENTS.map(c => [c.vendorId, c]),
);

export async function handler(_evt: unknown, ctx?: { getRemainingTimeInMillis?: () => number }): Promise<void> {
    // vendor is set through the VENDOR_ID env var
    const vendorId = process.env['VENDOR_ID'];
    if (!vendorId || !CLIENTS[vendorId]) throw new Error(`VENDOR_ID env must be one of: ${Object.keys(CLIENTS).join(', ')}`);

    const intervalMs = Number(process.env['INGEST_INTERVAL_MS'] ?? 3_600_000);
    const safetyMs = 30_000;
    const deadlineAt = Date.now() + (ctx?.getRemainingTimeInMillis?.() ?? 12 * 60_000) - safetyMs;

    // confirm vendor row exists in DB before doing any work (catches client/DB slug mismatch early)
    const vendorRow = await new VendorRepo(db).findById(vendorId);
    if (!vendorRow) throw new Error(`Vendor '${vendorId}' not found in vendors table — add a row before ingesting.`);

    // check if current ingestion run for this vendor is in progress
    const repo = new IngestionRunRepo(db);
    let run = await repo.findInProgress(vendorId);

    // create new run if no run is in progress and not on cooldown period
    if (!run) {
        const last = await repo.findLatest(vendorId);
        if (last?.completedAt && Date.now() - last.completedAt.getTime() < intervalMs) return;
        run = await repo.create(vendorId);
    }

    const pipeline = new VendorPipeline(CLIENTS[vendorId], new DrizzleRecordProcessor());
    let cursor = run.lastCursor ?? undefined;
    const stats = (run.stats ?? { processed: 0, succeeded: 0, failed: 0, skipped: 0, pagesFetched: 0 }) as IngestionStats;

    try {
        while (Date.now() < deadlineAt) {
            const page: PageResult = await pipeline.processPage(cursor);
            cursor = page.nextCursor;
            stats.processed += page.result.succeeded + page.result.failed + page.result.skipped;
            stats.succeeded += page.result.succeeded;
            stats.failed += page.result.failed;
            stats.skipped += page.result.skipped;
            stats.pagesFetched++;

            const completed = !page.hasMore;
            await repo.update(run.id, {
                lastCursor: completed ? null : (cursor ?? null),
                lastChunkAt: new Date(),
                stats,
                ...(completed ? { status: 'COMPLETED' as const, completedAt: new Date() } : {}),
            });
            if (completed) return;
        }
    } catch (e) {
        await repo.update(run.id, {
            status: 'FAILED',
            errorMessage: e instanceof Error ? e.message : String(e),
            stats,
        });
        throw e;
    }
}
