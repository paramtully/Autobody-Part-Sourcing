import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  vendorTypeEnum,
  integrationTypeEnum,
  vendorOrderingModeEnum,
} from './enums';

export const vendors = pgTable(
  'vendors',
  {
    // Slug PK — e.g. 'lkq', 'keystone', 'carpart-com'. Stable, human-readable,
    // matches the hardcoded vendorId on each VendorClient implementation.
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    vendorType: vendorTypeEnum('vendor_type').notNull(),
    integrationType: integrationTypeEnum('integration_type').notNull(),
    apiEndpoint: text('api_endpoint'),
    orderingMode: vendorOrderingModeEnum('ordering_mode').notNull().default('NOT_SUPPORTED'),
    supportsCancellation: boolean('supports_cancellation').notNull().default(false),
    supportsStatusLookup: boolean('supports_status_lookup').notNull().default(false),
    orderContactEmail: varchar('order_contact_email', { length: 255 }),
    averageProcessingTimeHours: integer('average_processing_time_hours'),
    reliabilityScore: numeric('reliability_score', { precision: 3, scale: 2 }),
    cancellationRate: numeric('cancellation_rate', { precision: 3, scale: 2 }),
    requiresManualOrdering: boolean('requires_manual_ordering').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reliabilityScoreCheck: check(
      'reliability_score_check',
      sql`${table.reliabilityScore} IS NULL OR (${table.reliabilityScore} >= 0 AND ${table.reliabilityScore} <= 1)`,
    ),
    cancellationRateCheck: check(
      'cancellation_rate_check',
      sql`${table.cancellationRate} IS NULL OR (${table.cancellationRate} >= 0 AND ${table.cancellationRate} <= 1)`,
    ),
  }),
);

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
    vendorId: varchar('vendor_id', { length: 50 })
      .notNull()
      .references(() => vendors.id, { onDelete: 'restrict' }),
    warehouseLocationId: uuid('warehouse_location_id')
      .notNull()
      .references(() => warehouseLocations.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.vendorId, table.warehouseLocationId] }),
  }),
);
