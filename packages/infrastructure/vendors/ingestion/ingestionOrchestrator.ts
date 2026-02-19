/**
 * IngestionOrchestrator (System 7)
 *
 * The ONLY place where all 7 systems are composed together.
 * All dependencies are injected via the constructor. Any dependency
 * can be undefined/null to disable that feature.
 *
 * Designed for chunked execution on Vercel Cron:
 * - Each invocation processes ONE page of vendor results
 * - Stores cursor + stats in ingestion_runs table
 * - Next cron tick resumes from the stored cursor
 * - Total time per invocation: well within 300s Vercel limit
 *
 * Data flow per chunk:
 * 1. Load or create IngestionRun from DB (checkpoint/resume)
 * 2. client.fetchInventoryPage(run.lastCursor) [wrapped in retry if retryOptions provided]
 * 3. rawPayloadLogger?.logBatch(rawResponse) [no-op if absent]
 * 4. For each record in page:
 *    a. Zod validate record
 *    b. dtoMapper.map(record) -> VendorInventoryDTO
 *    c. dataCleaner.clean(dto) -> CleanedDTO | ValidationFailure
 *    d. reconciler?.reconcile(cleanedDto) -> ReconciliationResult [skip if absent]
 *    e. if INSERT or UPDATE: repositories.listing.upsert(...)
 *    f. lifecycleManager?.recordSeen(...) [no-op if absent]
 * 5. Update ingestion_runs: save nextCursor, increment stats
 * 6. If !hasMore: mark run COMPLETED, run lifecycleManager?.detectStaleListings()
 * 7. Return IngestionChunkResult
 */

import { randomUUID } from 'crypto';
import type { VendorInventoryClient, UnknownRawVendorRecord } from '../inventoryClient';
import type { VendorInventoryDTO } from '../dto/vendorInventoryDTO';
import type { DTOMapper } from '../dto/dtoMapper';
import type { DataCleaner } from '../cleaning/dataCleaner';
import type { CleanedDTO } from '../cleaning/cleanedDTO';
import type { DomainReconciler } from '../reconciliation/domainReconciler';
import type { RawPayloadLogger } from '../logging/rawPayloadLogger';
import type { ListingLifecycleManager } from '../lifecycle/listingLifecycleManager';
import type { RetryOptions } from '../utils/retry';
import { RetryableVendorClient } from '../utils/retryableVendorClient';
import { vendorListingRecordSchema, type VendorListingRecord } from '../inventorySchema';
import type {
    IngestionRun,
    IngestionRunRepository,
} from './ingestionRun';
import { createIngestionRun, mergeChunkStats } from './ingestionRun';
import type { IngestionChunkResult, RecordProcessingResult } from './ingestionResult';

/**
 * Repository interfaces needed by the orchestrator.
 * Kept minimal -- only what the orchestrator actually calls.
 */
export interface IngestionRepositories {
    /** For ingestion run checkpoint/resume. */
    ingestionRuns: IngestionRunRepository;

    /**
     * Upsert a listing from a reconciled DTO.
     * The orchestrator is agnostic to the listing schema --
     * it passes the CleanedDTO and lets the repository handle mapping.
     */
    upsertListing(dto: CleanedDTO, action: 'INSERT' | 'UPDATE'): Promise<{ listingId: string }>;
}

/**
 * All dependencies injected into the orchestrator.
 * Optional dependencies can be undefined to disable that feature.
 */
export interface IngestionOrchestratorDeps {
    /** Required: the vendor client to fetch data from. */
    client: VendorInventoryClient;

    /** Optional: wraps client with retry logic. If undefined, no retry. */
    retryOptions?: RetryOptions;

    /** Optional: logs raw payloads for audit/replay. If undefined, no logging. */
    rawPayloadLogger?: RawPayloadLogger;

    /** Required: maps raw vendor records to DTOs. */
    dtoMapper: DTOMapper;

    /** Required: cleans and validates DTOs. */
    dataCleaner: DataCleaner;

    /** Optional: compares DTOs to existing DB state. If undefined, always INSERT. */
    reconciler?: DomainReconciler;

    /** Optional: tracks listing lifecycle (seen/stale). If undefined, no lifecycle tracking. */
    lifecycleManager?: ListingLifecycleManager;

    /** Required: database access for persisting results. */
    repositories: IngestionRepositories;
}

/**
 * Process a single chunk of vendor ingestion.
 *
 * This is the main entry point called by the Vercel Cron handler.
 * It processes one page, saves the checkpoint, and returns.
 *
 * @param deps - All injected dependencies
 * @param vendorId - Vendor to ingest
 * @returns Chunk result with stats and continuation info
 */
export async function processIngestionChunk(
    deps: IngestionOrchestratorDeps,
    vendorId: string
): Promise<IngestionChunkResult> {
    const startTime = Date.now();
    const ingestedAt = new Date().toISOString();

    // Resolve the client (with or without retry wrapper)
    const client = deps.retryOptions
        ? new RetryableVendorClient(deps.client, { retryOptions: deps.retryOptions })
        : deps.client;

    try {
        // 1. Load or create ingestion run
        const run = await loadOrCreateRun(deps.repositories.ingestionRuns, vendorId);

        // 2. Fetch one page from vendor
        const page = await client.fetchInventoryPage(run.lastCursor ?? undefined);

        // 3. Raw payload logging is now per-record after reconciliation
        //    (see processRecord). This avoids storing payloads for unchanged
        //    listings, cutting storage by ~90%. Page-level logging can still
        //    be done here if needed for full audit trail:
        //
        //    if (deps.rawPayloadLogger) {
        //      await deps.rawPayloadLogger.log({
        //        vendorId, payload: page.records, ingestionRunId: run.id,
        //      });
        //    }

        // 4. Process each record
        const recordResults: RecordProcessingResult[] = [];
        let succeeded = 0;
        let failed = 0;
        let skipped = 0;
        let conflicted = 0;

        for (const rawRecord of page.records) {
            const recordResult = await processRecord(
                rawRecord,
                vendorId,
                ingestedAt,
                deps
            );
            recordResults.push(recordResult);

            switch (recordResult.action) {
                case 'INSERTED':
                case 'UPDATED':
                    succeeded++;
                    break;
                case 'FAILED':
                    failed++;
                    break;
                case 'SKIPPED':
                    skipped++;
                    break;
                case 'CONFLICTED':
                    conflicted++;
                    break;
            }
        }

        // 5. Update run checkpoint
        mergeChunkStats(run, {
            processed: page.records.length,
            succeeded,
            failed,
            skipped,
            conflicted,
            pagesFetched: 1,
        });
        run.lastCursor = page.nextCursor ?? null;

        // 6. If no more pages, mark run as completed
        if (!page.hasMore) {
            run.status = 'COMPLETED';
            run.completedAt = new Date().toISOString();

            // Run stale listing detection if lifecycle manager is provided
            if (deps.lifecycleManager) {
                await deps.lifecycleManager.detectStaleListings(vendorId);
            }
        }

        await deps.repositories.ingestionRuns.updateRun(run);

        return {
            runId: run.id,
            vendorId,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor ?? null,
            chunkStats: {
                processed: page.records.length,
                succeeded,
                failed,
                skipped,
                conflicted,
                pagesFetched: 1,
            },
            status: 'SUCCESS',
            durationMs: Date.now() - startTime,
        };
    } catch (error) {
        // Mark run as failed if we can
        try {
            const run = await deps.repositories.ingestionRuns.findInProgressRun(vendorId);
            if (run) {
                run.status = 'FAILED';
                run.errorMessage = error instanceof Error ? error.message : String(error);
                run.completedAt = new Date().toISOString();
                await deps.repositories.ingestionRuns.updateRun(run);
            }
        } catch {
            // Best-effort: if we can't update the run, at least return the error
        }

        return {
            runId: 'unknown',
            vendorId,
            hasMore: false,
            nextCursor: null,
            chunkStats: { processed: 0, succeeded: 0, failed: 0, skipped: 0, conflicted: 0, pagesFetched: 0 },
            status: 'ERROR',
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startTime,
        };
    }
}

/**
 * Process a single raw record through the full pipeline.
 */
async function processRecord(
    rawRecord: UnknownRawVendorRecord,
    vendorId: string,
    ingestedAt: string,
    deps: IngestionOrchestratorDeps
): Promise<RecordProcessingResult> {
    const recordStart = Date.now();
    let externalId: string | undefined;

    try {
        // 4a. Zod validate
        const validated = vendorListingRecordSchema.safeParse(rawRecord);
        if (!validated.success) {
            return {
                action: 'FAILED',
                error: `Zod validation failed: ${validated.error.message}`,
                durationMs: Date.now() - recordStart,
            };
        }

        // 4b. Map to DTO
        const dto: VendorInventoryDTO = deps.dtoMapper.map(
            validated.data as VendorListingRecord,
            vendorId,
            ingestedAt
        );
        externalId = dto.vendorListingExternalId;

        // 4c. Clean DTO
        const cleanResult = deps.dataCleaner.clean(dto);
        if (!cleanResult.valid) {
            return {
                vendorListingExternalId: externalId,
                action: 'FAILED',
                error: `Cleaning failed: ${cleanResult.errors.map(e => e.message).join('; ')}`,
                durationMs: Date.now() - recordStart,
            };
        }

        const cleanedDto: CleanedDTO = cleanResult.data;

        // 4d. Reconcile (if reconciler provided)
        let action: 'INSERT' | 'UPDATE' | 'SKIP' | 'CONFLICT' = 'INSERT';
        if (deps.reconciler) {
            const reconcileResult = await deps.reconciler.reconcile(cleanedDto);
            action = reconcileResult.action;
        }

        // 4e. Log raw payload ONLY for changed records (INSERT or UPDATE)
        //     This is the key storage optimization: unchanged listings
        //     (SKIP) don't produce new raw_payloads rows.
        if (deps.rawPayloadLogger && (action === 'INSERT' || action === 'UPDATE')) {
            await deps.rawPayloadLogger.log({
                vendorId,
                payload: rawRecord,
                ingestionRunId: undefined, // Set by the orchestrator's run context if needed
                payloadHash: cleanedDto.payloadHash,
                vendorListingExternalId: externalId,
            });
        }

        // 4f. Upsert if INSERT or UPDATE
        if (action === 'INSERT' || action === 'UPDATE') {
            await deps.repositories.upsertListing(cleanedDto, action);
        }

        // 4g. Record seen (if lifecycle manager provided)
        if (deps.lifecycleManager && externalId) {
            await deps.lifecycleManager.recordSeen(vendorId, externalId, ingestedAt);
        }

        // Map action to result
        const resultAction: RecordProcessingResult['action'] =
            action === 'INSERT' ? 'INSERTED' :
                action === 'UPDATE' ? 'UPDATED' :
                    action === 'SKIP' ? 'SKIPPED' :
                        'CONFLICTED';

        return {
            vendorListingExternalId: externalId,
            action: resultAction,
            durationMs: Date.now() - recordStart,
        };
    } catch (error) {
        return {
            vendorListingExternalId: externalId,
            action: 'FAILED',
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - recordStart,
        };
    }
}

/**
 * Load an existing in-progress run, or create a new one.
 */
async function loadOrCreateRun(
    repository: IngestionRunRepository,
    vendorId: string
): Promise<IngestionRun> {
    const existing = await repository.findInProgressRun(vendorId);
    if (existing) {
        return existing;
    }

    const run = createIngestionRun(randomUUID(), vendorId);
    await repository.createRun(run);
    return run;
}
