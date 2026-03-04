import type { ListingWithRelations } from '../repositories/listing.repository';

// ── Shared timestamp ─────────────────────────────────────────────

const NOW = new Date('2026-02-28T00:00:00.000Z');

// ── Vendors ──────────────────────────────────────────────────────

const VENDOR_LKQ = {
  id: 'lkq',
  name: 'LKQ Online',
  vendorType: 'SALVAGE' as const,
  integrationType: 'API' as const,
  apiEndpoint: 'https://api.lkqcorp.com/v1',
  orderingMode: 'API_ASYNC' as const,
  supportsCancellation: false,
  supportsStatusLookup: true,
  orderContactEmail: null,
  averageProcessingTimeHours: 48,
  reliabilityScore: '0.92',
  cancellationRate: '0.05',
  requiresManualOrdering: false,
  createdAt: NOW,
  updatedAt: NOW,
};

const VENDOR_KEYSTONE = {
  id: 'keystone',
  name: 'Keystone Automotive',
  vendorType: 'AFTERMARKET' as const,
  integrationType: 'API' as const,
  apiEndpoint: 'https://api.keystoneautomotive.com/v2',
  orderingMode: 'API_SYNC' as const,
  supportsCancellation: true,
  supportsStatusLookup: true,
  orderContactEmail: 'orders@keystoneautomotive.com',
  averageProcessingTimeHours: 24,
  reliabilityScore: '0.96',
  cancellationRate: '0.02',
  requiresManualOrdering: false,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── Parts ────────────────────────────────────────────────────────

const PART_FRONT_BUMPER = {
  id: 'part-bumper-001',
  name: 'Front Bumper Cover',
  category: 'Bumpers',
  position: 'FRONT_BUMPER' as const,
  description: 'Front bumper cover assembly',
  weightGrams: 3500,
  isDiscontinued: false,
  createdAt: NOW,
  updatedAt: NOW,
};

const PART_FRONT_LEFT_FENDER = {
  id: 'part-fender-001',
  name: 'Front Left Fender',
  category: 'Fenders',
  position: 'FRONT_LEFT_FENDER' as const,
  description: 'Front driver-side fender panel',
  weightGrams: 5200,
  isDiscontinued: false,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── Part Identifiers ──────────────────────────────────────────────

const PI_BUMPER_OEM = {
  id: 'pi-bumper-oem-001',
  partId: PART_FRONT_BUMPER.id,
  type: 'OEM' as const,
  value: '52119-06902',
  manufacturer: 'Toyota',
  certification: null,
  createdAt: NOW,
};

const PI_FENDER_OEM = {
  id: 'pi-fender-oem-001',
  partId: PART_FRONT_LEFT_FENDER.id,
  type: 'OEM' as const,
  value: '53812-06170',
  manufacturer: 'Toyota',
  certification: null,
  createdAt: NOW,
};

const PI_FENDER_KEYSTONE = {
  id: 'pi-fender-am-001',
  partId: PART_FRONT_LEFT_FENDER.id,
  type: 'AFTERMARKET' as const,
  value: 'TO1240266',
  manufacturer: 'Keystone',
  certification: 'CAPA' as const,
  createdAt: NOW,
};

// ── Warehouse locations ───────────────────────────────────────────

const WAREHOUSE_DALLAS = {
  id: 'wh-dallas-001',
  country: 'US',
  stateOrProvince: 'TX',
  city: 'Dallas',
  postalCode: '75201',
};

// ── Listings ─────────────────────────────────────────────────────

export const FIXTURE_LISTINGS: ListingWithRelations[] = [
  {
    // Recycled OEM bumper from salvage yard (LKQ) — listed by OEM part number
    id: 'listing-001',
    vendorId: VENDOR_LKQ.id,
    partIdentifierId: PI_BUMPER_OEM.id,
    vendorListingExternalId: 'LKQ-9834521',
    sourceUrl: 'https://www.lkqonline.com/listing/9834521',
    condition: 'RECYCLED',
    description: '2019 Toyota Camry front bumper cover. Minor surface scratching. Paint code: 1F7.',
    sourceVehicleVin: '4T1B11HK8KU234512',
    sourceMileage: 42000,
    sourceDamageType: 'FRONT',
    quantityAvailable: 1,
    availabilityStatus: 'IN_STOCK',
    priceMinorMin: 8500,   // $85.00
    priceMinorMax: null,
    currency: 'USD',
    warehouseLocationId: WAREHOUSE_DALLAS.id,
    estimatedShipTimeHours: 48,
    estimatedDeliveryDate: null,
    source: 'VENDOR_API',
    lastVerifiedAt: NOW,
    confidenceScore: '0.90',
    isActive: true,
    payloadHash: 'hash-lkq-9834521',
    lastSeenAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    // Relations
    vendor: VENDOR_LKQ,
    partIdentifier: PI_BUMPER_OEM,
    part: PART_FRONT_BUMPER,
    allIdentifiers: [PI_BUMPER_OEM],
    images: [
      {
        id: 'img-001',
        listingId: 'listing-001',
        url: 'https://media.lkqonline.com/9834521_1.jpg',
        imageType: 'PRIMARY',
        sortOrder: 0,
        createdAt: NOW,
      },
    ],
    warehouseLocation: WAREHOUSE_DALLAS,
  },
  {
    // New CAPA-certified Keystone aftermarket fender
    id: 'listing-002',
    vendorId: VENDOR_KEYSTONE.id,
    partIdentifierId: PI_FENDER_KEYSTONE.id,
    vendorListingExternalId: 'KS-FEN-T-2019-FL',
    sourceUrl: null,
    condition: 'NEW_AFTERMARKET',
    description: 'Replacement front left fender for 2019–2022 Toyota Camry. CAPA certified.',
    sourceVehicleVin: null,
    sourceMileage: null,
    sourceDamageType: null,
    quantityAvailable: 12,
    availabilityStatus: 'IN_STOCK',
    priceMinorMin: 15900,  // $159.00
    priceMinorMax: null,
    currency: 'USD',
    warehouseLocationId: null,
    estimatedShipTimeHours: 24,
    estimatedDeliveryDate: null,
    source: 'VENDOR_API',
    lastVerifiedAt: NOW,
    confidenceScore: '0.98',
    isActive: true,
    payloadHash: 'hash-ks-fen-t-2019-fl',
    lastSeenAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    // Relations
    vendor: VENDOR_KEYSTONE,
    partIdentifier: PI_FENDER_KEYSTONE,
    part: PART_FRONT_LEFT_FENDER,
    allIdentifiers: [PI_FENDER_OEM, PI_FENDER_KEYSTONE],
    images: [],
    warehouseLocation: null,
  },
];
