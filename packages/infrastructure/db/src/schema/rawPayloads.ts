import { pgTable, uuid, varchar, text, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { rawPayloadStatusEnum } from './enums';
import { vendors } from './vendors';

/**
 * Raw payloads table.
 *
 * Stores raw vendor API responses for audit, replay, and debugging.
 * Uses Content-Addressable Storage (CAS) via payloadHash to deduplicate
 * identical payloads across ingestion runs.
 *
 * Storage optimization strategy:
 * 1. CAS deduplication: identical payloads share the same row (payloadHash unique)
 * 2. Conditional storage: orchestrator skips raw payload write if payloadHash
 *    matches the listing's current hash (no change = no storage)
 * 3. Retention policy: retainUntil sets a TTL; a cleanup cron job deletes
 *    expired rows to bound storage growth
 * 4. Sampling: configurable per-vendor sampling rate (store 10-100% of payloads)
 *
 * Sizing estimate: 3 vendors × 50K listings × 2KB avg payload
 * - Without optimization: ~300MB/day, ~9GB/month
 * - With skip-unchanged: ~30MB/day (only changed listings)
 * - With 30-day retention: bounded at ~900MB max
 */
export const rawPayloads = pgTable(
    'raw_payloads',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        vendorId: uuid('vendor_id')
            .notNull()
            .references(() => vendors.id, { onDelete: 'restrict' }),
        payload: jsonb('payload').notNull(),
        payloadHash: text('payload_hash').notNull(),
        ingestionTimestamp: timestamp('ingestion_timestamp', { withTimezone: true }).notNull().defaultNow(),
        status: rawPayloadStatusEnum('status').notNull().default('PENDING'),
        processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
        errorMessage: text('error_message'),

        /**
         * Links this payload to its source listing for per-listing deduplication.
         * Used to answer: "what was the last raw payload for this listing?"
         * Optional because some payloads may represent batch responses not tied to a single listing.
         */
        vendorListingExternalId: varchar('vendor_listing_external_id', { length: 255 }),

        /**
         * Ingestion run that produced this payload.
         * Links to ingestion_runs.id for traceability and replay auditing.
         */
        ingestionRunId: uuid('ingestion_run_id'),

        /**
         * Retention policy: when this payload can be safely deleted.
         * Set at ingestion time based on vendor config (default: 30 days from ingestion).
         * A cleanup cron job deletes rows where retainUntil < NOW().
         * NULL means retain indefinitely (use sparingly for critical audit records).
         */
        retainUntil: timestamp('retain_until', { withTimezone: true }),
    },
    (table) => ({
        payloadHashUnique: unique('raw_payloads_payload_hash_unique').on(table.payloadHash),
        payloadHashIdx: index('raw_payloads_payload_hash_idx').on(table.payloadHash),
        vendorIdIdx: index('raw_payloads_vendor_id_idx').on(table.vendorId),
        statusIdx: index('raw_payloads_status_idx').on(table.status),

        // Index for the retention cleanup job: DELETE FROM raw_payloads WHERE retain_until < NOW()
        retainUntilIdx: index('raw_payloads_retain_until_idx').on(table.retainUntil),

        // Index for per-listing payload history lookup
        vendorListingIdx: index('raw_payloads_vendor_listing_idx').on(table.vendorId, table.vendorListingExternalId),
    })
);
