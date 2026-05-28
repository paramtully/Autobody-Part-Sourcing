import {
    pgTable,
    uuid,
    varchar,
    text,
    timestamp,
    jsonb,
    check,
    index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ingestionRunStatusEnum } from './enums';
import { vendors } from './vendors';

// ── Ingestion Runs ────────────────────────────────────────────────
// Checkpoint/resume table for the paginated Lambda ingestion pipeline.
export const ingestionRuns = pgTable(
    'ingestion_runs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        vendorId: varchar('vendor_id', { length: 50 })
            .notNull()
            .references(() => vendors.id, { onDelete: 'restrict' }),
        status: ingestionRunStatusEnum('status').notNull().default('IN_PROGRESS'),
        lastCursor: text('last_cursor'),
        startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
        lastChunkAt: timestamp('last_chunk_at', { withTimezone: true }),
        completedAt: timestamp('completed_at', { withTimezone: true }),
        // Accumulated stats: { processed, succeeded, failed, skipped, pagesFetched }
        stats: jsonb('stats')
            .notNull()
            .default('{"processed":0,"succeeded":0,"failed":0,"skipped":0,"pagesFetched":0}'),
        errorMessage: text('error_message'),
    },
    (table) => ({
        vendorStatusIdx: index('ingestion_runs_vendor_status_idx').on(table.vendorId, table.status),
        vendorCompletedIdx: index('ingestion_runs_vendor_completed_idx').on(
            table.vendorId,
            table.completedAt,
        ),
        statsCheck: check('stats_not_null_check', sql`${table.stats} IS NOT NULL`),
    }),
);
