import { pgTable, uuid, varchar, text, integer, boolean, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { partPositionEnum, partIdentifierTypeEnum, certificationEnum } from './enums';

export const parts = pgTable('parts', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 100 }).notNull(),
    position: partPositionEnum('position'),
    description: text('description'),
    weightGrams: integer('weight_grams'),
    isDiscontinued: boolean('is_discontinued').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const partIdentifiers = pgTable(
    'part_identifiers',
    {
        partId: uuid('part_id')
            .notNull()
            .references(() => parts.id, { onDelete: 'restrict' }),
        type: partIdentifierTypeEnum('type').notNull(),
        value: varchar('value', { length: 255 }).notNull(),
        manufacturer: varchar('manufacturer', { length: 255 }).notNull(),
        certification: certificationEnum('certification'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.partId, table.type, table.value, table.manufacturer] }),
        valueIdx: index('part_identifiers_value_idx').on(table.value),
    })
);
