import { pgTable, uuid, varchar, integer, timestamp, primaryKey, unique, index } from 'drizzle-orm/pg-core';
import { fitmentConstraintEnum } from './enums';
import { parts } from './parts';

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
        // Unique constraint on (make, model, year, constraint, trim, engine)
        // This ensures one row per combination
        fitmentUnique: unique('fitments_unique').on(
            table.make,
            table.model,
            table.year,
            table.constraint,
            table.trim,
            table.engine
        ),
        // Query performance indexes
        makeModelYearIdx: index('fitments_make_model_year_idx').on(
        table.make,
        table.model,
        table.year
      ),
    })
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
    })
);
