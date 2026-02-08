import { pgTable, uuid, integer } from 'drizzle-orm/pg-core';
import { parts } from './parts';

export const partDimensions = pgTable('part_dimensions', {
  partId: uuid('part_id')
    .primaryKey()
    .references(() => parts.id, { onDelete: 'cascade' }),
  lengthMM: integer('length_mm').notNull(),
  widthMM: integer('width_mm').notNull(),
  heightMM: integer('height_mm').notNull(),
});
