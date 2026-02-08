import { pgEnum } from 'drizzle-orm/pg-core';

// Vendor enums
export const vendorTypeEnum = pgEnum('vendor_type', [
    'OEM',
    'AFTERMARKET',
    'SALVAGE',
    'MARKETPLACE',
]);

export const integrationTypeEnum = pgEnum('integration_type', [
    'API',
    'CSV',
    'SCRAPER',
    'MANUAL',
]);

// Listing enums
export const partConditionEnum = pgEnum('part_condition', [
    'NEW_OEM',
    'NEW_AFTERMARKET',
    'RECYCLED',
    'REMANUFACTURED',
    'RECONDITIONED',
    'UNKNOWN',
]);

export const availabilityStatusEnum = pgEnum('availability_status', [
    'IN_STOCK',
    'LOW_STOCK',
    'BACKORDER',
    'SPECIAL_ORDER',
    'UNKNOWN',
]);

export const currencyEnum = pgEnum('currency', [
    'USD',
    'EUR',
    'GBP',
    'CAD',
    'AUD',
    'NZD',
    'CHF',
    'JPY',
    'KRW',
    'CNY',
]);

export const dataSourceTypeEnum = pgEnum('data_source_type', [
    'VENDOR_API',
    'SCRAPER',
    'CSV_UPLOAD',
    'MANUAL_ENTRY',
]);

// Part enums
export const partPositionEnum = pgEnum('part_position', [
    'FRONT_BUMPER',
    'REAR_BUMPER',
    'FRONT_LEFT_FENDER',
    'FRONT_RIGHT_FENDER',
    'REAR_LEFT_FENDER',
    'REAR_RIGHT_FENDER',
    'HOOD',
    'TRUNK',
    'FRONT_LEFT_DOOR',
    'FRONT_RIGHT_DOOR',
    'REAR_LEFT_DOOR',
    'REAR_RIGHT_DOOR',
    'ROOF',
    'QUARTER_PANEL_LEFT',
    'QUARTER_PANEL_RIGHT',
    'GRILLE',
    'HEADLIGHT_LEFT',
    'HEADLIGHT_RIGHT',
    'TAILLIGHT_LEFT',
    'TAILLIGHT_RIGHT',
    'MIRROR_LEFT',
    'MIRROR_RIGHT',
    'WINDSHIELD',
    'REAR_WINDOW',
    'SIDE_WINDOW_LEFT',
    'SIDE_WINDOW_RIGHT',
    'DOOR_HANDLE_LEFT',
    'DOOR_HANDLE_RIGHT',
    'FENDER_LINER_LEFT',
    'FENDER_LINER_RIGHT',
    'OTHER',
]);

export const partIdentifierTypeEnum = pgEnum('part_identifier_type', [
    'OEM',
    'AFTERMARKET',
]);

export const certificationEnum = pgEnum('certification', ['CAPA', 'NSF']);

// Fitment enums
export const fitmentConstraintEnum = pgEnum('fitment_constraint', [
    'WITH_RADAR',
    'WITHOUT_RADAR',
    'WITH_PARKING_SENSORS',
    'WITHOUT_PARKING_SENSORS',
    'WITH_CAMERA',
    'WITHOUT_CAMERA',
    'LED',
    'HALOGEN',
    'HID',
    'ADAPTIVE',
    'SUNROOF',
    'NO_SUNROOF',
    'AWD',
    'FWD',
    'RWD',
]);

// Interchange enums
export const interchangeSystemEnum = pgEnum('interchange_system', [
    'HOLLANDER',
    'OPTICAT',
    'CCC',
    'LKQ',
    'VENDOR',
    'UNKNOWN',
]);

// RawPayload enums
export const rawPayloadStatusEnum = pgEnum('raw_payload_status', [
    'PENDING',
    'PROCESSED',
    'FAILED',
]);
