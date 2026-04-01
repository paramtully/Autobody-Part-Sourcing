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
    index,
    unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
    partConditionEnum,
    availabilityStatusEnum,
    currencyEnum,
    dataSourceTypeEnum,
} from './enums';
import { vendors, warehouseLocations } from './vendors';
import { partIdentifiers } from './parts';

export const listings = pgTable( 'listings', {
        id: uuid('id').primaryKey().defaultRandom(),
        vendorId: varchar('vendor_id', { length: 50 })
            .notNull()
            .references(() => vendors.id, { onDelete: 'restrict' }),
        // FK to the specific partIdentifier being sold (brand + part number captured there)
        partIdentifierId: uuid('part_identifier_id')
            .notNull()
            .references(() => partIdentifiers.id, { onDelete: 'restrict' }),
        vendorListingExternalId: varchar('vendor_listing_external_id', { length: 255 }),
        sourceUrl: text('source_url'),
        condition: partConditionEnum('condition').notNull(),
        description: text('description'),
        sourceVehicleVin: varchar('source_vehicle_vin', { length: 17 }),
        sourceMileage: integer('source_mileage'),
        sourceDamageType: varchar('source_damage_type', { length: 50 }),
        quantityAvailable: integer('quantity_available'),
        availabilityStatus: availabilityStatusEnum('availability_status').notNull(),
        priceMinorMin: integer('price_minor_min').notNull(),
        priceMinorMax: integer('price_minor_max'),
        currency: currencyEnum('currency').notNull(),
        warehouseLocationId: uuid('warehouse_location_id').references(() => warehouseLocations.id, {
            onDelete: 'restrict',
        }),
        estimatedShipTimeHours: integer('estimated_ship_time_hours'),
        estimatedDeliveryDate: timestamp('estimated_delivery_date', { withTimezone: true }),
        source: dataSourceTypeEnum('source').notNull(),
        lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true })
            .notNull()
            .defaultNow(),
        // Set by pipeline based on how strongly the record matched during validation
        confidenceScore: numeric('confidence_score', { precision: 3, scale: 2 }),
        isActive: boolean('is_active').default(true).notNull(),
        // Used for change detection: skip ingestion upsert when hash matches
        payloadHash: text('payload_hash'),
        // Lifecycle: set last_seen_at each ingestion; mark inactive if stale
        lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        priceMinCheck: check('price_minor_min_check', sql`${table.priceMinorMin} >= 0`),
        quantityCheck: check(
            'quantity_available_check',
            sql`${table.quantityAvailable} IS NULL OR ${table.quantityAvailable} >= 0`,
        ),
        // Required for upsertFromIngestion onConflictDoUpdate
        vendorExternalIdUnique: unique('listings_vendor_external_id_unique').on(
            table.vendorId,
            table.vendorListingExternalId,
        ),
        partIdentifierIdIdx: index('listings_part_identifier_id_idx').on(table.partIdentifierId),
        vendorIdIdx: index('listings_vendor_id_idx').on(table.vendorId),
        isActiveStatusIdx: index('listings_is_active_status_idx').on(
            table.isActive,
            table.availabilityStatus,
        ),
        vendorPartActiveIdx: index('listings_vendor_part_active_idx').on(
            table.vendorId,
            table.partIdentifierId,
            table.isActive,
        ),
        payloadHashIdx: index('listings_payload_hash_idx').on(table.payloadHash),
        vendorActiveLastSeenIdx: index('listings_vendor_active_last_seen_idx').on(
            table.vendorId,
            table.isActive,
            table.lastSeenAt,
        ),
    }),
);

export const listingImages = pgTable('listing_images', {
        url: text('url').notNull().primaryKey(),
        listingId: uuid('listing_id')
            .notNull()
            .references(() => listings.id, { onDelete: 'cascade' }),
        imageType: text('image_type'), // PRIMARY, ANGLE, DAMAGE, STOCK
        sortOrder: integer('sort_order'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => ({
        listingIdIdx: index('listing_images_listing_id_idx').on(table.listingId),
    }),
);
