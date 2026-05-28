import {
    pgTable,
    uuid,
    varchar,
    integer,
    timestamp,
    jsonb,
    check,
    index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
    orderStatusEnum,
    currencyEnum,
    paymentStatusEnum,
} from './enums';
import { listings } from './listings';
import { vendors } from './vendors';

// ── Checkout Quotes ──────────────────────────────────────────────
// Short-lived price locks. Deleted (not marked used) on confirm.
export const checkoutQuotes = pgTable('checkout_quotes', {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
        .notNull()
        .references(() => listings.id, { onDelete: 'restrict' }),
    shippingAddress: jsonb('shipping_address').notNull(),
    partPriceMinor: integer('part_price_minor').notNull(),
    serviceFeeMinor: integer('service_fee_minor').notNull(),
    shippingMinor: integer('shipping_minor').notNull(),
    taxMinor: integer('tax_minor').notNull(),
    totalMinor: integer('total_minor').notNull(),
    currency: currencyEnum('currency').notNull(),
    vendorQuoteReference: varchar('vendor_quote_reference', { length: 255 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Orders ────────────────────────────────────────────────────────
export const orders = pgTable(
    'orders',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderNumber: varchar('order_number', { length: 32 }).unique().notNull(),
        status: orderStatusEnum('status').notNull(),
        contactEmail: varchar('contact_email', { length: 255 }).notNull(),
        contactPhone: varchar('contact_phone', { length: 50 }),
        orderLookupToken: varchar('order_lookup_token', { length: 64 }).unique().notNull(),
        idempotencyKey: varchar('idempotency_key', { length: 128 }).unique().notNull(),
        listingId: uuid('listing_id')
            .notNull()
            .references(() => listings.id, { onDelete: 'restrict' }),
        vendorId: varchar('vendor_id', { length: 50 })
            .notNull()
            .references(() => vendors.id, { onDelete: 'restrict' }),
        shippingAddress: jsonb('shipping_address').notNull(),
        // Pricing locked at checkout
        partPriceMinor: integer('part_price_minor').notNull(),
        serviceFeeMinor: integer('service_fee_minor').notNull(),
        shippingMinor: integer('shipping_minor').notNull(),
        taxMinor: integer('tax_minor').notNull(),
        totalMinor: integer('total_minor').notNull(),
        currency: currencyEnum('currency').notNull(),
        totalRefundedMinor: integer('total_refunded_minor').notNull().default(0),
        // Vendor tracking
        vendorOrderId: varchar('vendor_order_id', { length: 255 }),
        /** Set when a worker claims the order for vendor placement; used for lease expiry. */
        claimedAt: timestamp('claimed_at', { withTimezone: true }),
        // Payment — inline instead of a separate payments table (1:1 for MVP)
        paymentProviderPaymentId: varchar('payment_provider_payment_id', { length: 255 }),
        paymentStatus: paymentStatusEnum('payment_status'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        totalMinCheck: check('total_minor_min_check', sql`${table.totalMinor} >= 100`),
        refundedMaxCheck: check(
            'total_refunded_max_check',
            sql`${table.totalRefundedMinor} <= ${table.totalMinor}`,
        ),
        statusIdx: index('orders_status_idx').on(table.status),
    }),
);
