import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { orderStatusEnum } from './enums';
import { orders } from './orders';

export const orderStatusHistory = pgTable(
    'order_status_history',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderId: uuid('order_id')
            .notNull()
            .references(() => orders.id, { onDelete: 'cascade' }),
        fromStatus: orderStatusEnum('from_status'), // NULL for initial DRAFT
        toStatus: orderStatusEnum('to_status').notNull(),
        reason: text('reason'),
        actor: varchar('actor', { length: 100 }).notNull(), // 'system', 'customer', 'admin', 'vendor'
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
);
