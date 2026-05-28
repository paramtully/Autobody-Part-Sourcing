import {
    pgTable,
    uuid,
    varchar,
    text,
    integer,
    boolean,
    timestamp,
    primaryKey,
    unique,
    index,
    check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
    partCategoryEnum,
    partPositionEnum,
    partIdentifierTypeEnum,
    certificationEnum,
    fitmentConstraintEnum,
} from './enums';

export const parts = pgTable('parts', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    category: partCategoryEnum('category').notNull(),
    position: partPositionEnum('position'),
    description: text('description'),
    weightGrams: integer('weight_grams'),
    isDiscontinued: boolean('is_discontinued').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
},
 (table) => ({
        uniqueIdentifier: unique('parts_name_category_unique').on(table.name, table.category),
    }),
);

export const partIdentifiers = pgTable(
    'part_identifiers',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        partId: uuid('part_id')
            .notNull()
            .references(() => parts.id, { onDelete: 'restrict' }),
        type: partIdentifierTypeEnum('type').notNull(),
        value: varchar('value', { length: 255 }).notNull(),
        // Nullable: INTERCHANGE type (e.g. Hollander numbers) may have no manufacturer
        manufacturer: varchar('manufacturer', { length: 255 }),
        certification: certificationEnum('certification'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        uniqueIdentifier: unique('part_identifiers_unique').on(table.partId, table.type, table.value, table.manufacturer),
        valueIdx: index('part_identifiers_value_idx').on(table.value),
        valueFormatCheck: check(
            'part_identifiers_value_format_check',
            sql`${table.value} = upper(${table.value})
                AND ${table.value} NOT LIKE '%-%'
                AND ${table.value} = btrim(${table.value})
                AND length(${table.value}) > 0`,
        ),
    }),
);

export const fitments = pgTable(
    'fitments',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        make: varchar('make', { length: 100 }).notNull(),
        model: varchar('model', { length: 100 }).notNull(),
        year: integer('year').notNull(),
        constraint: fitmentConstraintEnum('constraint'),
        trim: varchar('trim', { length: 255 }),
        engine: varchar('engine', { length: 255 }),
    },
    (table) => ({
        fitmentUnique: unique('fitments_unique').on(
            table.make,
            table.model,
            table.year,
            table.constraint,
            table.trim,
            table.engine,
        ),
        makeModelYearIdx: index('fitments_make_model_year_idx').on(table.make, table.model, table.year),
    }),
);

export const partFitments = pgTable(
    'part_fitments',
    {
        partId: uuid('part_id')
            .notNull()
            .references(() => parts.id, { onDelete: 'restrict' }),
        fitmentId: uuid('fitment_id')
            .notNull()
            .references(() => fitments.id, { onDelete: 'restrict' }),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.partId, table.fitmentId] }),
    }),
);
