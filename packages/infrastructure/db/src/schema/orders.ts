import { pgTable, uuid, varchar, integer, numeric, timestamp, jsonb, check, index } from 'drizzle-orm/pg-core';
import { orderStatusEnum, partConditionEnum, currencyEnum, vendorOrderingModeEnum } from './enums';
import { listings } from './listings';
import { vendors } from './vendors';
import { checkoutQuotes } from './checkoutQuotes';

export const orders = pgTable(
    'orders',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderNumber: varchar('order_number', { length: 32 }).unique().notNull(),
        status: orderStatusEnum('status').notNull(),

        // Identity
        userId: uuid('user_id'), // No FK yet — added when auth is introduced
        contactEmail: varchar('contact_email', { length: 255 }).notNull(),
        contactPhone: varchar('contact_phone', { length: 50 }),
        orderLookupToken: varchar('order_lookup_token', { length: 64 }).unique().notNull(),
        idempotencyKey: varchar('idempotency_key', { length: 128 }).unique().notNull(),

        // References
        quoteId: uuid('quote_id').references(() => checkoutQuotes.id, { onDelete: 'restrict' }),
        listingId: uuid('listing_id')
            .notNull()
            .references(() => listings.id, { onDelete: 'restrict' }),
        vendorId: uuid('vendor_id')
            .notNull()
            .references(() => vendors.id, { onDelete: 'restrict' }),

        // Shipping address snapshot
        shippingAddress: jsonb('shipping_address').notNull(),

        // Listing snapshot — frozen at checkout
        snapshotPartName: varchar('snapshot_part_name', { length: 255 }),
        snapshotPartNumber: varchar('snapshot_part_number', { length: 255 }),
        snapshotCondition: partConditionEnum('snapshot_condition'),
        snapshotVendorName: varchar('snapshot_vendor_name', { length: 255 }),
        snapshotListingPriceMinor: integer('snapshot_listing_price_minor'),
        snapshotCurrency: currencyEnum('snapshot_currency'),

        // Pricing
        partPriceMinor: integer('part_price_minor').notNull(),
        serviceFeeMinor: integer('service_fee_minor').notNull(),
        feePercentApplied: numeric('fee_percent_applied', { precision: 5, scale: 4 }).notNull(),
        shippingMinor: integer('shipping_minor').notNull(),
        taxMinor: integer('tax_minor').notNull(),
        totalMinor: integer('total_minor').notNull(),
        currency: currencyEnum('currency').notNull(),

        // Refund tracking
        totalRefundedMinor: integer('total_refunded_minor').notNull().default(0),

        // Vendor order tracking
        vendorOrderId: varchar('vendor_order_id', { length: 255 }),
        vendorOrderingMode: vendorOrderingModeEnum('vendor_ordering_mode').notNull(),
        vendorOrderPlacedAt: timestamp('vendor_order_placed_at', { withTimezone: true }),
        vendorOrderConfirmedAt: timestamp('vendor_order_confirmed_at', { withTimezone: true }),

        // Timestamps
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        // Check constraints
        totalMinCheck: check('total_minor_min_check', `"${table.totalMinor.name}" >= 100`),
        refundedNonNegativeCheck: check('total_refunded_non_negative_check', `"${table.totalRefundedMinor.name}" >= 0`),
        refundedMaxCheck: check('total_refunded_max_check', `"${table.totalRefundedMinor.name}" <= "${table.totalMinor.name}"`),

        // Indexes
        statusIdx: index('orders_status_idx').on(table.status),
        userIdIdx: index('orders_user_id_idx').on(table.userId),
        listingIdIdx: index('orders_listing_id_idx').on(table.listingId),
        vendorIdIdx: index('orders_vendor_id_idx').on(table.vendorId),
    }),
);
