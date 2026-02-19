import { pgTable, uuid, integer, numeric, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { currencyEnum } from './enums';
import { listings } from './listings';
import { vendors } from './vendors';

export const checkoutQuotes = pgTable(
    'checkout_quotes',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        listingId: uuid('listing_id')
            .notNull()
            .references(() => listings.id, { onDelete: 'restrict' }),
        vendorId: uuid('vendor_id')
            .notNull()
            .references(() => vendors.id, { onDelete: 'restrict' }),
        shippingAddress: jsonb('shipping_address').notNull(),
        partPriceMinor: integer('part_price_minor').notNull(),
        serviceFeeMinor: integer('service_fee_minor').notNull(),
        feePercentApplied: numeric('fee_percent_applied', { precision: 5, scale: 4 }).notNull(),
        shippingMinor: integer('shipping_minor').notNull(),
        taxMinor: integer('tax_minor').notNull(),
        totalMinor: integer('total_minor').notNull(),
        currency: currencyEnum('currency').notNull(),
        vendorQuoteReference: varchar('vendor_quote_reference', { length: 255 }),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        usedAt: timestamp('used_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
);
