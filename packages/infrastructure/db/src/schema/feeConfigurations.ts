import { pgTable, uuid, numeric, text, timestamp } from 'drizzle-orm/pg-core';

export const feeConfigurations = pgTable(
    'fee_configurations',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        feePercent: numeric('fee_percent', { precision: 5, scale: 4 }).notNull(),
        description: text('description'),
        effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
        effectiveUntil: timestamp('effective_until', { withTimezone: true }), // NULL = currently active
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
);
