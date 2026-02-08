import { pgTable, uuid, text, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { rawPayloadStatusEnum } from './enums';
import { vendors } from './vendors';

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
    },
    (table) => ({
        payloadHashUnique: unique('raw_payloads_payload_hash_unique').on(table.payloadHash),
        payloadHashIdx: index('raw_payloads_payload_hash_idx').on(table.payloadHash),
        vendorIdIdx: index('raw_payloads_vendor_id_idx').on(table.vendorId),
        statusIdx: index('raw_payloads_status_idx').on(table.status),
    })
);
