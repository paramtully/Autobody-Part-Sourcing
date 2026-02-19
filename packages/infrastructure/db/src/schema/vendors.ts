import { pgTable, uuid, varchar, text, integer, numeric, boolean, timestamp, check } from 'drizzle-orm/pg-core';
import { vendorTypeEnum, integrationTypeEnum, vendorOrderingModeEnum } from './enums';

export const vendors = pgTable(
    'vendors',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        name: varchar('name', { length: 255 }).notNull(),
        vendorType: vendorTypeEnum('vendor_type').notNull(),
        integrationType: integrationTypeEnum('integration_type').notNull(),
        apiEndpoint: text('api_endpoint'),

        // Ordering capability
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
        reliabilityScoreCheck: check('reliability_score_check', `"${table.reliabilityScore.name}" IS NULL OR ("${table.reliabilityScore.name}" >= 0 AND "${table.reliabilityScore.name}" <= 1)`),
        cancellationRateCheck: check('cancellation_rate_check', `"${table.cancellationRate.name}" IS NULL OR ("${table.cancellationRate.name}" >= 0 AND "${table.cancellationRate.name}" <= 1)`),
    })
);
