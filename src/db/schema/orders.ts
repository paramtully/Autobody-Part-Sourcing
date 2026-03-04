import {
    pgTable,
    uuid,
    varchar,
    integer,
    numeric,
    timestamp,
    jsonb,
    text,
    check,
    index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
    orderStatusEnum,
    partConditionEnum,
    currencyEnum,
    vendorOrderingModeEnum,
} from './enums';
import { listings } from './listings';
import { vendors } from './vendors';

// ── Checkout Quotes ──────────────────────────────────────────────
export const checkoutQuotes = pgTable('checkout_quotes', {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
        .notNull()
        .references(() => listings.id, { onDelete: 'restrict' }),
    vendorId: varchar('vendor_id', { length: 50 })
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
});

// ── Orders ────────────────────────────────────────────────────────
export const orders = pgTable(
    'orders',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderNumber: varchar('order_number', { length: 32 }).unique().notNull(),
        status: orderStatusEnum('status').notNull(),
        userId: uuid('user_id'),
        contactEmail: varchar('contact_email', { length: 255 }).notNull(),
        contactPhone: varchar('contact_phone', { length: 50 }),
        orderLookupToken: varchar('order_lookup_token', { length: 64 }).unique().notNull(),
        idempotencyKey: varchar('idempotency_key', { length: 128 }).unique().notNull(),
        quoteId: uuid('quote_id').references(() => checkoutQuotes.id, { onDelete: 'restrict' }),
        listingId: uuid('listing_id')
            .notNull()
            .references(() => listings.id, { onDelete: 'restrict' }),
        vendorId: varchar('vendor_id', { length: 50 })
            .notNull()
            .references(() => vendors.id, { onDelete: 'restrict' }),
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
        totalRefundedMinor: integer('total_refunded_minor').notNull().default(0),
        // Vendor order tracking
        vendorOrderId: varchar('vendor_order_id', { length: 255 }),
        vendorOrderingMode: vendorOrderingModeEnum('vendor_ordering_mode').notNull(),
        vendorOrderPlacedAt: timestamp('vendor_order_placed_at', { withTimezone: true }),
        vendorOrderConfirmedAt: timestamp('vendor_order_confirmed_at', { withTimezone: true }),
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
        userIdIdx: index('orders_user_id_idx').on(table.userId),
        listingIdIdx: index('orders_listing_id_idx').on(table.listingId),
    }),
);

// ── Order Status History ─────────────────────────────────────────
export const orderStatusHistory = pgTable('order_status_history', {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
        .notNull()
        .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatusEnum('from_status'),
    toStatus: orderStatusEnum('to_status').notNull(),
    reason: text('reason'),
    actor: varchar('actor', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Fee Configurations ────────────────────────────────────────────
export const feeConfigurations = pgTable('fee_configurations', {
    id: uuid('id').primaryKey().defaultRandom(),
    feePercent: numeric('fee_percent', { precision: 5, scale: 4 }).notNull(),
    description: text('description'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveUntil: timestamp('effective_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Vendor Email Logs ─────────────────────────────────────────────
export const vendorEmailLogs = pgTable(
    'vendor_email_logs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderId: uuid('order_id').references(() => orders.id, { onDelete: 'restrict' }),
        fromAddress: varchar('from_address', { length: 255 }).notNull(),
        toAddress: varchar('to_address', { length: 255 }).notNull(),
        subject: text('subject'),
        rawBody: text('raw_body'),
        parsedStatus: varchar('parsed_status', { length: 50 }),
        parsedTracking: varchar('parsed_tracking', { length: 255 }),
        processingStatus: varchar('processing_status', { length: 50 }).notNull().default('PENDING'),
        receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        orderIdIdx: index('vendor_email_logs_order_id_idx').on(table.orderId),
    }),
);
