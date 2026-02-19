import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { orders } from './orders';

export const vendorEmailLogs = pgTable(
    'vendor_email_logs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderId: uuid('order_id')
            .references(() => orders.id, { onDelete: 'restrict' }),
        fromAddress: varchar('from_address', { length: 255 }).notNull(),
        toAddress: varchar('to_address', { length: 255 }).notNull(),
        subject: text('subject'),
        rawBody: text('raw_body'),
        parsedStatus: varchar('parsed_status', { length: 50 }), // 'CONFIRMED', 'REJECTED', 'INFO'
        parsedTracking: varchar('parsed_tracking', { length: 255 }),
        processingStatus: varchar('processing_status', { length: 50 }).notNull().default('PENDING'),
        receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        orderIdIdx: index('vendor_email_logs_order_id_idx').on(table.orderId),
        processingStatusIdx: index('vendor_email_logs_processing_status_idx').on(table.processingStatus),
    }),
);
