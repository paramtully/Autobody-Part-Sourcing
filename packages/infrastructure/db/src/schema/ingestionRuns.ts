import { pgTable, uuid, varchar, text, integer, timestamp, jsonb, check, index } from 'drizzle-orm/pg-core';
import { vendors } from './vendors';

/**
 * Ingestion run status enum.
 *
 * IN_PROGRESS: Currently being processed (chunked execution)
 * COMPLETED: All pages fetched and processed
 * FAILED: Unrecoverable error during processing
 * CANCELLED: Manually or programmatically cancelled
 */
import { pgEnum } from 'drizzle-orm/pg-core';

export const ingestionRunStatusEnum = pgEnum('ingestion_run_status', [
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
]);

/**
 * Ingestion runs table.
 *
 * Tracks each ingestion pipeline invocation for:
 * - Checkpoint/resume: serverless chunked execution saves cursor here
 * - Operational monitoring: track success rates, durations, record counts
 * - SLO tracking: detect stale vendors or degraded ingestion quality
 * - Replay auditing: link ingested records back to the run that created them
 *
 * Each Vercel Cron tick creates or resumes one row per vendor.
 * Stats are accumulated across chunks via mergeChunkStats().
 */
export const ingestionRuns = pgTable(
    'ingestion_runs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        vendorId: uuid('vendor_id')
            .notNull()
            .references(() => vendors.id, { onDelete: 'restrict' }),

        status: ingestionRunStatusEnum('status').notNull().default('IN_PROGRESS'),

        /** Pagination cursor for the next page (null = starting fresh). */
        lastCursor: text('last_cursor'),

        /** When this run was first created. */
        startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),

        /** When the last chunk was processed (updated each cron tick). */
        lastChunkAt: timestamp('last_chunk_at', { withTimezone: true }),

        /** When this run completed or failed (null while IN_PROGRESS). */
        completedAt: timestamp('completed_at', { withTimezone: true }),

        /**
         * Accumulated statistics across all chunks.
         * Stored as JSONB for flexibility; typed as IngestionRunStats in app layer.
         * Shape: { processed, succeeded, failed, skipped, conflicted, pagesFetched }
         */
        stats: jsonb('stats').notNull().default('{"processed":0,"succeeded":0,"failed":0,"skipped":0,"conflicted":0,"pagesFetched":0}'),

        /** Error message if the run failed (null on success). */
        errorMessage: text('error_message'),
    },
    (table) => ({
        // Index for finding the in-progress run for a vendor (the main checkpoint/resume query)
        vendorStatusIdx: index('ingestion_runs_vendor_status_idx').on(table.vendorId, table.status),

        // Index for finding the last completed run (for SLO monitoring)
        vendorCompletedIdx: index('ingestion_runs_vendor_completed_idx').on(table.vendorId, table.completedAt),

        // Ensure stats JSON is not null (defensive)
        statsCheck: check('stats_not_null_check', `"${table.stats.name}" IS NOT NULL`),
    })
);
