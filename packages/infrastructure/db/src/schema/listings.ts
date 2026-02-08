import { pgTable, uuid, varchar, text, integer, numeric, boolean, timestamp, check, index } from 'drizzle-orm/pg-core';
import { partConditionEnum, availabilityStatusEnum, currencyEnum, dataSourceTypeEnum } from './enums';
import { vendors } from './vendors';
import { parts } from './parts';
import { warehouseLocations } from './warehouseLocations';

export const listings = pgTable(
    'listings',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        vendorId: uuid('vendor_id')
            .notNull()
            .references(() => vendors.id, { onDelete: 'restrict' }),
        partId: uuid('part_id')
            .notNull()
            .references(() => parts.id, { onDelete: 'restrict' }),
        vendorListingExternalId: varchar('vendor_listing_external_id', { length: 255 }),
        sourceUrl: text('source_url'),
        condition: partConditionEnum('condition').notNull(),
        description: text('description'),
        quantityAvailable: integer('quantity_available'),
        availabilityStatus: availabilityStatusEnum('availability_status').notNull(),
        priceMinorMin: integer('price_minor_min').notNull(),
        priceMinorMax: integer('price_minor_max'),
        currency: currencyEnum('currency').notNull(),
        warehouseLocationId: uuid('warehouse_location_id')
            .references(() => warehouseLocations.id, { onDelete: 'restrict' }),
        estimatedShipTimeHours: integer('estimated_ship_time_hours'),
        estimatedDeliveryDate: timestamp('estimated_delivery_date', { withTimezone: true }),
        source: dataSourceTypeEnum('source').notNull(),
        lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
        confidenceScore: numeric('confidence_score', { precision: 3, scale: 2 }),
        isActive: boolean('is_active').default(true).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        // Unique constraint: (vendorId, vendorListingExternalId) OR (vendorId, sourceUrl)
        // Note: PostgreSQL doesn't support OR in unique constraints directly.
        // Partial unique indexes will be created in migrations via raw SQL:
        // CREATE UNIQUE INDEX listings_vendor_external_id_unique ON listings (vendor_id, vendor_listing_external_id) WHERE vendor_listing_external_id IS NOT NULL;
        // CREATE UNIQUE INDEX listings_vendor_source_url_unique ON listings (vendor_id, source_url) WHERE source_url IS NOT NULL;
        // Application layer (Zod validator) ensures at least one is present.

        // Check constraints
        priceMinCheck: check('price_minor_min_check', `"${table.priceMinorMin.name}" >= 0`),
        priceMaxCheck: check('price_minor_max_check', `"${table.priceMinorMax.name}" IS NULL OR "${table.priceMinorMax.name}" >= "${table.priceMinorMin.name}"`),
        quantityCheck: check('quantity_available_check', `"${table.quantityAvailable.name}" IS NULL OR "${table.quantityAvailable.name}" >= 0`),
        confidenceCheck: check('confidence_score_check', `"${table.confidenceScore.name}" IS NULL OR ("${table.confidenceScore.name}" >= 0 AND "${table.confidenceScore.name}" <= 1)`),

        // Indexes
        partIdIdx: index('listings_part_id_idx').on(table.partId),
        vendorIdIdx: index('listings_vendor_id_idx').on(table.vendorId),
        isActiveStatusIdx: index('listings_is_active_status_idx').on(table.isActive, table.availabilityStatus),
        // Aggregation indexes for inventory queries
        vendorPartActiveIdx: index('listings_vendor_part_active_idx').on(table.vendorId, table.partId, table.isActive),
        vendorPartConditionIdx: index('listings_vendor_part_condition_idx').on(table.vendorId, table.partId, table.condition),
    })
);
