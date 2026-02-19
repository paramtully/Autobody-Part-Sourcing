import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { listings } from './listings';

export const listingHolds = pgTable(
    'listing_holds',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        listingId: uuid('listing_id')
            .notNull()
            .references(() => listings.id, { onDelete: 'restrict' }),
        orderId: uuid('order_id').notNull(),
        // Note: FK to orders not declared here to avoid circular reference;
        // enforced in migration SQL.
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        releasedAt: timestamp('released_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    // Partial unique index (listing_holds_active_unique) is created in migration SQL
);
