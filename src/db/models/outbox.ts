import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Transactional outbox. Events are inserted in the same DB transaction
 * as the state change they represent, then published asynchronously by
 * OutboxPublisher. Guarantees at-least-once delivery; consumers must be idempotent.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topic: varchar('topic', { length: 100 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 50 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
  },
  (table) => ({
    publishedAtIdx: index('outbox_events_published_at_idx').on(
      table.publishedAt,
      table.createdAt,
    ),
  }),
);
