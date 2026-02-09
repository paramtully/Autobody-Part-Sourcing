import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { listings } from './listings';

export const listingImages = pgTable(
    'listing_images',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        listingId: uuid('listing_id')
            .notNull()
            .references(() => listings.id, { onDelete: 'cascade' }),
        url: text('url').notNull(),
        imageType: text('image_type'), // PRIMARY, ANGLE, DAMAGE, STOCK
        source: text('source'),
        sortOrder: integer('sort_order'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        // Index on listing_id for efficient queries when fetching images for a listing
        listingIdIdx: index('listing_images_listing_id_idx').on(table.listingId),
    })
);
