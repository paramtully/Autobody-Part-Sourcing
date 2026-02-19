import { pgTable, uuid, varchar, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { paymentProviderEnum, refundStatusEnum } from './enums';
import { orders } from './orders';
import { payments } from './payments';

export const refunds = pgTable(
    'refunds',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderId: uuid('order_id')
            .notNull()
            .references(() => orders.id, { onDelete: 'restrict' }),
        paymentId: uuid('payment_id')
            .notNull()
            .references(() => payments.id, { onDelete: 'restrict' }),
        provider: paymentProviderEnum('provider').notNull(),
        providerRefundId: varchar('provider_refund_id', { length: 255 }).unique().notNull(),
        amountMinor: integer('amount_minor').notNull(),
        serviceFeeRefundMinor: integer('service_fee_refund_minor').notNull(),
        reason: text('reason'),
        status: refundStatusEnum('status').notNull(),
        initiatedBy: varchar('initiated_by', { length: 100 }).notNull(), // 'system', 'admin', 'vendor'
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
);
