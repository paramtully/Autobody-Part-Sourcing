import { pgTable, uuid, varchar, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const outboxEvents = pgTable(
    'outbox_events',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        topic: varchar('topic', { length: 255 }).notNull(),
        aggregateType: varchar('aggregate_type', { length: 100 }).notNull(), // 'order', 'payment', 'refund'
        aggregateId: uuid('aggregate_id').notNull(),
        payload: jsonb('payload').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        publishedAt: timestamp('published_at', { withTimezone: true }),
        failedAt: timestamp('failed_at', { withTimezone: true }),
        retryCount: integer('retry_count').notNull().default(0),
    },
    (table) => ({
        unpublishedIdx: index('outbox_events_unpublished_idx').on(table.publishedAt, table.createdAt),
    }),
);
