import { pgTable, uuid, varchar, timestamp, primaryKey, unique, numeric, check } from 'drizzle-orm/pg-core';
import { interchangeSystemEnum } from './enums';
import { parts } from './parts';

export const interchanges = pgTable(
    'interchanges',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        system: interchangeSystemEnum('system').notNull(),
        code: varchar('code', { length: 255 }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        systemCodeUnique: unique('interchanges_system_code_unique').on(table.system, table.code),
    })
);

export const interchangeMemberships = pgTable(
    'interchange_memberships',
    {
        partId: uuid('part_id')
            .notNull()
            .references(() => parts.id, { onDelete: 'restrict' }),
        interchangeId: uuid('interchange_id')
            .notNull()
            .references(() => interchanges.id, { onDelete: 'restrict' }),
        confidence: numeric('confidence', { precision: 3, scale: 2 }),
        source: varchar('source', { length: 255 }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.partId, table.interchangeId] }),
        confidenceCheck: check('confidence_check', `"${table.confidence.name}" IS NULL OR ("${table.confidence.name}" >= 0 AND "${table.confidence.name}" <= 1)`),
    })
);
