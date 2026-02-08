import { pgTable, uuid, varchar, text, primaryKey } from 'drizzle-orm/pg-core';
import { vendors } from './vendors';

export const warehouseLocations = pgTable('warehouse_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  country: varchar('country', { length: 100 }).notNull(),
  stateOrProvince: varchar('state_or_province', { length: 100 }),
  city: varchar('city', { length: 100 }),
  postalCode: varchar('postal_code', { length: 20 }),
});

export const vendorWarehouseLocations = pgTable(
  'vendor_warehouse_locations',
  {
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),
    warehouseLocationId: uuid('warehouse_location_id')
      .notNull()
      .references(() => warehouseLocations.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.vendorId, table.warehouseLocationId] }),
  })
);
