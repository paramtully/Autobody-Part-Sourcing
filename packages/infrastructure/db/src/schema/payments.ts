import { pgTable, uuid, varchar, integer, timestamp, text, jsonb } from 'drizzle-orm/pg-core';
import { paymentStatusEnum, paymentProviderEnum, currencyEnum } from './enums';
import { orders } from './orders';

export const payments = pgTable(
    'payments',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderId: uuid('order_id')
            .unique()
            .notNull()
            .references(() => orders.id, { onDelete: 'restrict' }),
        provider: paymentProviderEnum('provider').notNull(),
        providerPaymentId: varchar('provider_payment_id', { length: 255 }).unique().notNull(),
        providerIdempotencyKey: varchar('provider_idempotency_key', { length: 128 }).unique().notNull(),
        status: paymentStatusEnum('status').notNull(),
        amountMinor: integer('amount_minor').notNull(),
        currency: currencyEnum('currency').notNull(),
        authorizedAt: timestamp('authorized_at', { withTimezone: true }),
        authExpiresAt: timestamp('auth_expires_at', { withTimezone: true }),
        capturedAt: timestamp('captured_at', { withTimezone: true }),
        cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
        failureReason: text('failure_reason'),
        providerMetadata: jsonb('provider_metadata'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
);
