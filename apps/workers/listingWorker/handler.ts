import { db, IngestionRunRepo, VendorRepo } from '@repo/db';
import type { IngestionStats } from '@repo/db';
import { VendorPipeline, DrizzleRecordProcessor, eBayVendorClient, VendorError } from '@repo/vendors';
import type { PageResult, VendorInventoryClient } from '@repo/vendors';

// vendorId is the single source of truth — the key is derived from the client, not hardcoded separately
const ALL_CLIENTS: VendorInventoryClient[] = [
    // new LKQVendorClient(),
    new eBayVendorClient({ vendorId: 'ebay-us', marketplaceId: 'EBAY_US', tradingSiteId: '100' }),
    new eBayVendorClient({ vendorId: 'ebay-ca', marketplaceId: 'EBAY_CA', tradingSiteId: '2' }),
];
const CLIENTS: Record<string, VendorInventoryClient> = Object.fromEntries(
    ALL_CLIENTS.map(c => [c.vendorId, c]),
);

/** Retryable vendor/network errors — pause and resume, do not mark FAILED. */
function isTransientIngestError(e: unknown): boolean {
    if (e instanceof VendorError && e.isRetryable) return true;
    const msg = e instanceof Error ? e.message : String(e);
    return /aborted due to timeout|ECONNRESET|ETIMEDOUT|socket hang up|Failed query/i.test(msg);
}

/** FAILED runs with a cursor that failed on transient errors should auto-resume. */
function isResumableFailedRun(errorMessage: string | null | undefined): boolean {
    const msg = errorMessage ?? '';
    if (/authenticate|AUTH_ERROR|VALIDATION_ERROR|not found in vendors/i.test(msg)) return false;
    return msg.length === 0 || isTransientIngestError(new Error(msg));
}

export async function handler(_evt: unknown, ctx?: { getRemainingTimeInMillis?: () => number }): Promise<void> {
    // vendor is set through the VENDOR_ID env var
    const vendorId = process.env['VENDOR_ID'];
    if (!vendorId || !CLIENTS[vendorId]) throw new Error(`VENDOR_ID env must be one of: ${Object.keys(CLIENTS).join(', ')}`);

    // default to 180 minute ingestion interval, with 3 minute safety margin and 12 minute Lambda timeout
    const intervalMs = Number(process.env['INGEST_INTERVAL_MS'] ?? 180 * 60 * 1000);
    // 6 hour cooldown after rate limit; each new limit updates lastChunkAt and restarts the window
    const rateLimitPauseMs = Number(process.env['RATE_LIMIT_PAUSE_MS'] ?? 6 * 60 * 60 * 1000);
    const safetyMs = 3 * 60 * 1000;
    const runtimeMs = ctx?.getRemainingTimeInMillis?.() ?? Number(process.env['INGEST_TIMEOUT_MS'] ?? 12 * 60 * 1000);
    const deadlineAt = Date.now() + runtimeMs - safetyMs;

    // confirm vendor row exists in DB before doing any work (catches client/DB slug mismatch early)
    const vendorRow = await new VendorRepo(db).findById(vendorId);
    if (!vendorRow) throw new Error(`Vendor '${vendorId}' not found in vendors table — add a row before ingesting.`);

    // check if current ingestion run for this vendor is in progress
    const repo = new IngestionRunRepo(db);
    let run = await repo.findInProgress(vendorId);

    // create new run if no run is in progress and not on cooldown period
    if (!run) {
        const last = await repo.findLatest(vendorId);
        if (last?.status === 'RATE_LIMITED' && last.lastChunkAt) {
            const elapsed = Date.now() - last.lastChunkAt.getTime();
            if (elapsed < rateLimitPauseMs) {
                const remainMin = Math.ceil((rateLimitPauseMs - elapsed) / 60_000);
                console.log(`[ingest] rate-limit pause — ${remainMin}m left (set RATE_LIMIT_PAUSE_MS to override)`);
                return;
            }
            await repo.update(last.id, { status: 'IN_PROGRESS' });
            run = { ...last, status: 'IN_PROGRESS' as const };
            console.log(`[ingest] resuming rate-limited run ${run.id} for vendor '${vendorId}' from cursor ${run.lastCursor ?? 'start'}`);
        } else if (last?.status === 'FAILED' && last.lastCursor && isResumableFailedRun(last.errorMessage)) {
            await repo.update(last.id, { status: 'IN_PROGRESS', errorMessage: null });
            run = { ...last, status: 'IN_PROGRESS' as const };
            console.log(`[ingest] resuming failed run ${run.id} for vendor '${vendorId}' from cursor ${run.lastCursor}`);
        } else if (last?.completedAt && Date.now() - last.completedAt.getTime() < intervalMs) {
            const cooldownRemainMin = Math.ceil((intervalMs - (Date.now() - last.completedAt.getTime())) / 60_000);
            console.log(`[ingest] skipping — last run completed at ${last.completedAt.toISOString()}, cooldown has ${cooldownRemainMin}m left (set INGEST_INTERVAL_MS=0 to disable)`);
            return;
        }
        if (!run) {
            run = await repo.create(vendorId);
            console.log(`[ingest] starting new run ${run.id} for vendor '${vendorId}'`);
        }
    } else {
        console.log(`[ingest] resuming in-progress run ${run.id} for vendor '${vendorId}' from cursor ${run.lastCursor ?? 'start'}`);
    }

    const pipeline = new VendorPipeline(CLIENTS[vendorId], new DrizzleRecordProcessor());
    let cursor = run.lastCursor ?? undefined;
    const stats = (run.stats ?? { processed: 0, succeeded: 0, failed: 0, skipped: 0, pagesFetched: 0 }) as IngestionStats;

    try {
        while (Date.now() < deadlineAt) {
            console.log(`[ingest] fetching page (cursor=${cursor ?? 'start'}, pages so far=${stats.pagesFetched})`);
            const page: PageResult = await pipeline.processPage(cursor);
            cursor = page.nextCursor;
            stats.processed += page.result.succeeded + page.result.failed + page.result.skipped;
            stats.succeeded += page.result.succeeded;
            stats.failed += page.result.failed;
            stats.skipped += page.result.skipped;
            stats.pagesFetched++;

            console.log(`[ingest] page done — succeeded=${page.result.succeeded} failed=${page.result.failed} skipped=${page.result.skipped} hasMore=${page.hasMore}`);

            const completed = !page.hasMore;
            await repo.update(run.id, {
                lastCursor: completed ? null : (cursor ?? null),
                lastChunkAt: new Date(),
                stats,
                ...(completed ? { status: 'COMPLETED' as const, completedAt: new Date() } : {}),
            });
            if (completed) {
                console.log(`[ingest] run ${run.id} completed — total: processed=${stats.processed} succeeded=${stats.succeeded} failed=${stats.failed} skipped=${stats.skipped}`);
                return;
            }
        }
        console.log(`[ingest] deadline reached — run ${run.id} paused at cursor=${cursor ?? 'start'}, will resume next invocation`);
    } catch (e) {
        if (e instanceof VendorError && e.type === 'RATE_LIMIT') {
            await repo.update(run.id, {
                status: 'RATE_LIMITED',
                lastCursor: cursor ?? null,
                lastChunkAt: new Date(),
                stats,
            });
            console.log(`[ingest] rate limited — run ${run.id} paused at cursor=${cursor ?? 'start'}, will resume after RATE_LIMIT_PAUSE_MS`);
            return;
        }
        if (isTransientIngestError(e)) {
            await repo.update(run.id, {
                lastCursor: cursor ?? null,
                lastChunkAt: new Date(),
                stats,
            });
            const label = e instanceof VendorError ? e.type : 'TRANSIENT';
            console.log(`[ingest] ${label} — run ${run.id} paused at cursor=${cursor ?? 'start'}, will resume next invocation`);
            return;
        }
        await repo.update(run.id, {
            status: 'FAILED',
            lastCursor: cursor ?? null,
            errorMessage: e instanceof Error ? e.message : String(e),
            stats,
        });
        throw e;
    }
}
