import eBayVendorClient from './vendorClient.ebay';
import { VendorError } from '../vendorError';
import {
  mapEbayCondition,
  mapEbayItemAvailability,
  mapEbayConstraint,
  mapEbayCategory,
} from './schema.ebay.item';
import { mockFetchSequence, restoreFetch } from '../../../../test/setup/mockFetch';

const validItem = require('../../../../test/fixtures/ebay/itemDetail.valid.json');
const invalidItem = require('../../../../test/fixtures/ebay/itemDetail.invalid.json');
const nompnItem = require('../../../../test/fixtures/ebay/itemDetail.nompn.json');
const quarterPanelItem = require('../../../../test/fixtures/ebay/itemDetail.quarterPanel.json');
const pairItem = require('../../../../test/fixtures/ebay/itemDetail.pair.json');
const searchPage = require('../../../../test/fixtures/ebay/itemSummarySearch.json');
const oauthToken = require('../../../../test/fixtures/ebay/oauthToken.json');

afterEach(() => restoreFetch());

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeClient() {
  return new eBayVendorClient({ vendorId: 'ebay-ca', marketplaceId: 'EBAY_CA', tradingSiteId: '2' });
}

/** Returns a mock sequence that satisfies auth + one search + N item-detail calls. */
function authThenSearch(itemDetailResponses: unknown[]) {
  return mockFetchSequence([
    { body: oauthToken },           // POST /oauth2/token
    { body: searchPage },            // GET /item_summary/search
    ...itemDetailResponses.map(b => ({ body: b })),
  ]);
}

// ── identity ──────────────────────────────────────────────────────────────────

describe('identity', () => {
  it('vendorId matches slug pattern', () => {
    const client = makeClient();
    expect(client.vendorId).toMatch(/^[a-z0-9-]+$/);
  });
});

// ── mapRecord ────────────────────────────────────────────────────────────────

describe('mapRecord', () => {
  it('happy path — maps a valid item to VendorRecord', () => {
    const client = makeClient();
    const record = client.mapRecord(validItem);

    // part — name from "Part Name" aspect; Type hint "Front Bumper Cover Complete" → BUMPER_COVER
    expect(record.part.name).toBe('Front Bumper Cover');
    expect(record.part.category).toBe('BUMPER_COVER');
    expect(record.part.position).toBe('FRONT_BUMPER');

    // identifiers: 4 Partslink NI... (AFTERMARKET/Nissan) + 2 unique OEM cross-refs.
    // Classifier detects NI prefix → AFTERMARKET/Nissan despite brand being "Texas-E-Parts".
    // Interchange aspect values that match the Nissan OEM pattern collapse into existing
    // OEM keys (dedup by `${type}:${dashStrippedValue}`), keeping the identifier set tight.
    expect(record.identifiers.length).toBeGreaterThanOrEqual(6);
    expect(record.identifiers.some(i => i.value === 'NI1039163')).toBe(true);
    expect(record.identifiers.some(i => i.value === 'NI1000323')).toBe(true);
    const ni = record.identifiers.find(i => i.value === 'NI1039163')!;
    expect(ni.type).toBe('AFTERMARKET');
    expect(ni.manufacturer).toBe('Nissan');  // classifier detects NI prefix; brand ignored

    // listing
    expect(record.listing.vendorListingExternalId).toBe('v1|277644944264|0');
    expect(record.listing.sourceUrl).toBe('https://www.ebay.com/itm/277644944264');
    expect(record.listing.priceMinorMin).toBe(8495);
    expect(record.listing.currency).toBe('USD');
    expect(record.listing.condition).toBe('NEW_AFTERMARKET');
    expect(record.listing.description).toBe('Front bumper cover for 2019-2021 Nissan Altima. Primed and ready for paint.');
    expect(record.listing.quantityAvailable).toBe(5);
    expect(record.listing.availabilityStatus).toBe('IN_STOCK');
    expect(record.listing.estimatedShipTimeHours).toBeGreaterThan(0);
    expect(record.listing.images).toHaveLength(2);
    expect(record.listing.images![0]!.url).toBe('https://i.ebayimg.com/images/g/abc/s-l500.jpg');
    // masked postal code stripped
    expect(record.listing.warehouseLocation?.postalCode).toBeUndefined();
    expect(record.listing.warehouseLocation?.country).toBe('US');

    // fitments
    expect(record.fitments.length).toBe(1);
    expect(record.fitments[0]).toMatchObject({ make: 'Nissan', model: 'Altima', year: 2020 });
  });

  it('brand cleanup — junk brand yields undefined manufacturer on fallback identifier', () => {
    const client = makeClient();
    const item = {
      ...validItem,
      localizedAspects: [{ name: 'Brand', value: 'Unbranded' }],
    };
    const record = client.mapRecord(item);
    // With no MPN/Partslink/OE aspects and junk brand, falls back to legacyItemId INTERCHANGE
    expect(record.identifiers[0]!.type).toBe('INTERCHANGE');
    expect(record.identifiers[0]!.manufacturer).toBeUndefined();
  });

  it('brand cleanup — seller username as brand yields undefined manufacturer', () => {
    const client = makeClient();
    // Use the fixture seller's own username as the Brand value — should be cleaned to undefined
    const item = {
      ...validItem,
      localizedAspects: [{ name: 'Brand', value: 'texas-e-parts' }],
    };
    const record = client.mapRecord(item);
    // No MPN/Partslink/OE aspects → falls back to legacyItemId INTERCHANGE
    expect(record.identifiers[0]!.type).toBe('INTERCHANGE');
    expect(record.identifiers[0]!.manufacturer).toBeUndefined();
  });

  it('comma-separated Partslink emits one identifier per value with correct manufacturer', () => {
    const client = makeClient();
    const item = {
      ...validItem,
      localizedAspects: [
        { name: 'Manufacturer Part Number', value: 'MYPART-001' },
        { name: 'Partslink Number', value: 'HO1000296, HO1241185' },
        { name: 'Brand', value: 'Dorman' },
      ],
    };
    const record = client.mapRecord(item);
    // Classifier detects HO prefix → AFTERMARKET/Honda regardless of source aspect
    const partslinks = record.identifiers.filter(i => i.value === 'HO1000296' || i.value === 'HO1241185');
    expect(partslinks).toHaveLength(2);
    expect(partslinks[0]!.value).toBe('HO1000296');
    expect(partslinks[0]!.type).toBe('AFTERMARKET');
    expect(partslinks[0]!.manufacturer).toBe('Honda');
    expect(partslinks[1]!.value).toBe('HO1241185');
    expect(partslinks[1]!.type).toBe('AFTERMARKET');
    expect(partslinks[1]!.manufacturer).toBe('Honda');
  });

  it('multi-vehicle placement (comma in value) yields undefined position', () => {
    const client = makeClient();
    const item = {
      ...validItem,
      localizedAspects: [
        { name: 'Placement on Vehicle', value: 'Front, Rear' },
        { name: 'Part Name', value: 'Bumper Cover' },
      ],
    };
    const record = client.mapRecord(item);
    expect(record.part.position).toBeUndefined();
  });

  it('blank Vehicle Part Location does not block title-based placement', () => {
    const client = makeClient();
    const item = {
      ...validItem,
      title: '2018 Honda Civic Left Headlight Assembly',
      localizedAspects: [
        { name: 'Part Name', value: 'Headlight' },
        { name: 'Type', value: 'Headlight' },
        { name: 'Vehicle Part Location', value: '' },
      ],
      categoryPath: 'eBay Motors|Parts & Accessories|Lighting & Lamps|Headlights',
      primaryCategory: { categoryId: '33710', categoryName: 'Headlight Assemblies' },
    };
    const record = client.mapRecord(item);
    expect(record.part.position).toBe('HEADLIGHT_LEFT');
  });

  it('validation failure — throws VendorError(VALIDATION_ERROR) for invalid raw record', () => {
    const client = makeClient();
    let caught: unknown;
    try {
      client.mapRecord(invalidItem);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VendorError);
    expect((caught as VendorError).type).toBe('VALIDATION_ERROR');
  });

  it('validation failure — empty object', () => {
    const client = makeClient();
    expect(() => client.mapRecord({})).toThrow(VendorError);
  });

  it('price conversion — "$12.99" → 1299 cents', () => {
    const client = makeClient();
    const item = { ...validItem, price: { value: '12.99', currency: 'USD' } };
    const record = client.mapRecord(item);
    expect(record.listing.priceMinorMin).toBe(1299);
  });

  it('price conversion — missing price → 0', () => {
    const client = makeClient();
    const { price: _, ...itemWithoutPrice } = validItem;
    const record = client.mapRecord(itemWithoutPrice);
    expect(record.listing.priceMinorMin).toBe(0);
  });

  it('at-least-one-identifier invariant — falls back to INTERCHANGE when no mpn', () => {
    const client = makeClient();
    const record = client.mapRecord(nompnItem);
    expect(record.identifiers.length).toBeGreaterThanOrEqual(1);
    expect(record.identifiers[0]!.type).toBe('INTERCHANGE');
    expect(record.identifiers[0]!.value).toBeTruthy();
  });

  it('fitments derived when make+model+year all present', () => {
    const client = makeClient();
    const record = client.mapRecord(validItem);
    expect(record.fitments.length).toBe(1);
    expect(record.fitments[0]).toMatchObject({ make: 'Nissan', model: 'Altima', year: 2020 });
  });

  it('quarter panel under Panels|Fenders categoryPath maps via Type aspect', () => {
    const client = makeClient();
    const record = client.mapRecord(quarterPanelItem);
    // "Quarter Panel" Type hint overrides the broad "Fenders" categoryPath
    expect(record.part.category).toBe('QUARTER_PANEL');
    // "Rear, Left" placement: not ambiguous (rear ≠ front, left ≠ right) → QUARTER_PANEL_LEFT
    expect(record.part.position).toBe('QUARTER_PANEL_LEFT');
  });

  it('pair listing with Placement "Left, Right" yields undefined position', () => {
    const client = makeClient();
    const record = client.mapRecord(pairItem);
    // Both left AND right specified → truly ambiguous pair → no position
    expect(record.part.position).toBeUndefined();
    expect(record.part.category).toBe('HEADLIGHT');
  });

  it('junk identifier values are dropped before reaching the record', () => {
    const client = makeClient();
    const item = {
      ...validItem,
      localizedAspects: [
        { name: 'Manufacturer Part Number', value: '100 Pcs Automotive Push Type Retainer Kit' },
        { name: 'Brand', value: 'Unbranded' },
      ],
    };
    const record = client.mapRecord(item);
    // No identifier value should be the full product-description string
    expect(record.identifiers.every(i => !i.value.includes('Push Type Retainer'))).toBe(true);
    // Falls back to legacyItemId INTERCHANGE since all tokens are junk or empty
    const hasInterchange = record.identifiers.some(i => i.type === 'INTERCHANGE');
    expect(hasInterchange).toBe(true);
  });

  it('fitments empty when Year is missing from compatibilityProperties', () => {
    const client = makeClient();
    const item = {
      ...validItem,
      compatibilityProperties: [
        { name: 'Make', value: 'Honda' },
        { name: 'Model', value: 'Civic' },
        // No "Year"
      ],
    };
    const record = client.mapRecord(item);
    expect(record.fitments).toEqual([]);
  });

  it('condition — "New" with AFTERMARKET Partslink identifiers stays NEW_AFTERMARKET', () => {
    const client = makeClient();
    const record = client.mapRecord(validItem);
    // NI-prefixed Partslinks → AFTERMARKET; no OEM upgrade
    expect(record.listing.condition).toBe('NEW_AFTERMARKET');
  });

  it('condition — "New" with Honda OEM-pattern MPN upgrades to NEW_OEM', () => {
    const client = makeClient();
    const item = {
      ...validItem,
      condition: 'New',
      localizedAspects: [
        { name: 'Manufacturer Part Number', value: '04711-TBA-A90ZZ' },
        { name: 'Brand', value: 'Honda' },
      ],
    };
    const record = client.mapRecord(item);
    // Honda OEM pattern → identifiers[0].type === 'OEM' → condition upgraded
    expect(record.identifiers[0]!.type).toBe('OEM');
    expect(record.listing.condition).toBe('NEW_OEM');
  });

  it('position from title when Placement aspect absent', () => {
    const client = makeClient();
    const item = {
      ...validItem,
      title: '2018 Honda Civic Left Headlight Assembly',
      localizedAspects: [
        { name: 'Part Name', value: 'Headlight' },
        { name: 'Type', value: 'Headlight' },
        // No Placement on Vehicle aspect
      ],
      categoryPath: 'eBay Motors|Parts & Accessories|Lighting & Lamps|Headlights',
      primaryCategory: { categoryId: '33710', categoryName: 'Headlight Assemblies' },
    };
    const record = client.mapRecord(item);
    expect(record.part.category).toBe('HEADLIGHT');
    expect(record.part.position).toBe('HEADLIGHT_LEFT');
  });

  it('pure-alphabetic MPN tokens are dropped by isJunkIdentifier', () => {
    const client = makeClient();
    const item = {
      ...validItem,
      localizedAspects: [
        { name: 'Manufacturer Part Number', value: 'Civic Sedan Bumper' },
        { name: 'Brand', value: 'Unbranded' },
      ],
    };
    const record = client.mapRecord(item);
    // All tokens are pure-alpha (no digit) → none become identifiers; falls back to INTERCHANGE
    expect(record.identifiers.every(i => !/^[a-zA-Z ]+$/.test(i.value))).toBe(true);
    expect(record.identifiers.some(i => i.type === 'INTERCHANGE')).toBe(true);
  });
});

// ── fetchInventoryPage ────────────────────────────────────────────────────────

describe('fetchInventoryPage', () => {
  it('normal — returns records, hasMore: true, nextCursor from first page', async () => {
    // auth + search (has next) + 2 item detail calls
    const spy = authThenSearch([validItem, validItem]);
    const client = makeClient();
    const result = await client.fetchInventoryPage();

    expect(Array.isArray(result.records)).toBe(true);
    expect(result.records.length).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('0:200');
    const searchUrl = String(spy.mock.calls[1]![0]);
    expect(searchUrl).toContain('q=bumper');
    expect(searchUrl).toContain('category_ids=33637');
  });

  it('category index 1 — search includes q (required for L1 categories)', async () => {
    const spy = authThenSearch([validItem, validItem]);
    const client = makeClient();
    await client.fetchInventoryPage('1:0');
    const searchUrl = String(spy.mock.calls[1]![0]);
    expect(searchUrl).toContain('q=fender');
    expect(searchUrl).toContain('category_ids=33714');
    expect(searchUrl).toContain('offset=0');
  });

  it('last page — hasMore: false when no next link on last category', async () => {
    // Cursor '5:0' = last category (index 5), offset 0. No next link → all categories exhausted.
    const lastPage = { ...searchPage, next: undefined };
    mockFetchSequence([
      { body: oauthToken },
      { body: lastPage },
      { body: validItem },
      { body: validItem },
    ]);
    const client = makeClient();
    const result = await client.fetchInventoryPage('5:0');
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it('empty itemSummaries on last category — throws VendorError(INVALID_REQUEST)', async () => {
    // Must be at the last category (5:0) for the no-data guard to fire.
    mockFetchSequence([
      { body: oauthToken },
      { body: { ...searchPage, itemSummaries: [], next: undefined } },
    ]);
    const client = makeClient();
    await expect(client.fetchInventoryPage('5:0')).rejects.toMatchObject({
      type: 'INVALID_REQUEST',
    });
  });

  it('429 on search — throws VendorError(RATE_LIMIT) with retryAfterMs', async () => {
    mockFetchSequence([
      { body: oauthToken },
      { body: { errors: [{ errorId: 88013 }] }, status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '2' } },
    ]);
    const client = makeClient();
    let caught: unknown;
    try {
      await client.fetchInventoryPage();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VendorError);
    expect((caught as VendorError).type).toBe('RATE_LIMIT');
    expect((caught as VendorError).retryAfterMs).toBe(2000);
  });

  it('401 on search — throws VendorError(AUTH_ERROR)', async () => {
    mockFetchSequence([
      { body: oauthToken },
      { body: { errors: [] }, status: 401 },
    ]);
    const client = makeClient();
    await expect(client.fetchInventoryPage()).rejects.toMatchObject({
      type: 'AUTH_ERROR',
    });
  });

  it('per-item 404 is silently skipped (no throw, fewer records)', async () => {
    // 3 summaries in search, but one item detail 404s → only 2 records returned
    const searchWithThree = {
      ...searchPage,
      itemSummaries: [
        ...searchPage.itemSummaries,
        { itemId: 'v1|111000001|0', title: 'Third Item', price: { value: '10.00', currency: 'USD' } },
      ],
    };
    mockFetchSequence([
      { body: oauthToken },
      { body: searchWithThree },
      { body: validItem },
      { body: {}, status: 404 },  // third item 404s
      { body: validItem },
    ]);
    const client = makeClient();
    const result = await client.fetchInventoryPage();
    expect(result.records.length).toBe(2);
  });
});

// ── auth / getAuthStatus ──────────────────────────────────────────────────────

describe('auth', () => {
  it('first call fetches token; second call within window reuses it (called once)', async () => {
    const spy = mockFetchSequence([{ body: oauthToken }]);
    const client = makeClient();
    const status1 = await client.getAuthStatus();
    const status2 = await client.getAuthStatus();

    expect(status1.valid).toBe(true);
    expect(status1.expiresAt).toBeInstanceOf(Date);
    expect(status2.valid).toBe(true);
    // Token endpoint was only hit once
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('401 on token endpoint — getAuthStatus rejects with VendorError(AUTH_ERROR)', async () => {
    mockFetchSequence([{ body: { error: 'invalid_client' }, status: 401 }]);
    const client = makeClient();
    await expect(client.getAuthStatus()).rejects.toMatchObject({
      type: 'AUTH_ERROR',
    });
  });
});

// ── mapEbayCondition ─────────────────────────────────────────────────────────

describe('mapEbayCondition', () => {
  const cases: Array<[string | undefined, string]> = [
    ['New', 'NEW_AFTERMARKET'],
    ['Like New', 'RECYCLED'],
    ['Seller refurbished', 'RECONDITIONED'],
    ['remanufactured grade A', 'REMANUFACTURED'],
    [undefined, 'RECYCLED'],
    ['mystery condition', 'RECYCLED'],
    ['Used', 'RECYCLED'],
    ['Manufacturer refurbished', 'REMANUFACTURED'],
  ];

  it.each(cases)('"%s" → %s', (input, expected) => {
    expect(mapEbayCondition(input)).toBe(expected);
  });
});

// ── mapEbayItemAvailability ───────────────────────────────────────────────────

describe('mapEbayItemAvailability', () => {
  const cases: Array<[number | null | undefined, string]> = [
    [null, 'UNKNOWN'],
    [undefined, 'UNKNOWN'],
    [0, 'BACKORDER'],
    [1, 'LOW_STOCK'],
    [2, 'LOW_STOCK'],
    [3, 'IN_STOCK'],
    [100, 'IN_STOCK'],
  ];

  it.each(cases)('%s → %s', (qty, expected) => {
    expect(mapEbayItemAvailability(qty)).toBe(expected);
  });
});

// ── mapEbayCategory ───────────────────────────────────────────────────────────

describe('mapEbayCategory', () => {
  // [categoryPath, categoryName, hints, expected]
  const cases: Array<[string | undefined, string | undefined, string | undefined, string]> = [
    // categoryPath drives the match (hints=undefined)
    ['eBay Motors|Parts & Accessories|Body Parts|Bumpers & Bumper Parts', undefined, undefined, 'BUMPER'],
    ['eBay Motors|Parts & Accessories|Body Parts|Bumper Covers', undefined, undefined, 'BUMPER_COVER'],
    ['eBay Motors|Parts & Accessories|Body Parts|Fenders', undefined, undefined, 'FENDER'],
    ['eBay Motors|Parts & Accessories|Body Parts|Fender Liners', undefined, undefined, 'FENDER_LINER'],
    ['eBay Motors|Parts & Accessories|Lighting & Lamps|Headlights', undefined, undefined, 'HEADLIGHT'],
    ['eBay Motors|Parts & Accessories|Lighting & Lamps|Taillights', undefined, undefined, 'TAILLIGHT'],
    ['eBay Motors|Parts & Accessories|Lighting & Lamps|Fog Lights', undefined, undefined, 'FOG_LIGHT'],
    ['eBay Motors|Parts & Accessories|Glass|Windshields', undefined, undefined, 'WINDSHIELD'],
    ['eBay Motors|Parts & Accessories|Glass|Rear Window Glass', undefined, undefined, 'REAR_WINDOW'],
    ['eBay Motors|Parts & Accessories|Body Parts|Doors', undefined, undefined, 'DOOR'],
    ['eBay Motors|Parts & Accessories|Body Parts|Door Handles', undefined, undefined, 'DOOR_HANDLE'],
    ['eBay Motors|Parts & Accessories|Body Parts|Hoods', undefined, undefined, 'HOOD'],
    ['eBay Motors|Parts & Accessories|Mirrors|Side View Mirrors', undefined, undefined, 'MIRROR'],
    ['eBay Motors|Parts & Accessories|Mirrors|Mirror Glass', undefined, undefined, 'MIRROR_GLASS'],
    // categoryName as fallback when path is absent
    [undefined, 'Bumpers & Bumper Parts', undefined, 'BUMPER'],
    [undefined, 'Headlights', undefined, 'HEADLIGHT'],
    [undefined, 'Grilles', undefined, 'GRILLE'],
    [undefined, 'Moldings', undefined, 'MOLDING'],
    // unrecognized → OTHER
    [undefined, undefined, undefined, 'OTHER'],
    [undefined, 'Auto Parts', undefined, 'OTHER'],
    ['eBay Motors|Parts & Accessories', 'Auto Parts', undefined, 'OTHER'],
    // hints override broad categoryPath: "Bumper cover" hint beats "Bumpers & Reinforcements" breadcrumb
    ['eBay Motors|Parts & Accessories|Bumpers & Reinforcements', undefined, 'Bumper cover', 'BUMPER_COVER'],
    // "Quarter Panel" hint beats the "Fenders" categoryPath
    ['eBay Motors|Parts & Accessories|Panels|Fenders', undefined, 'Quarter Panel', 'QUARTER_PANEL'],
    // no hint — broad categoryPath alone → BUMPER (not BUMPER_COVER)
    ['eBay Motors|Parts & Accessories|Bumpers & Reinforcements', undefined, undefined, 'BUMPER'],
  ];

  it.each(cases)('categoryPath=%s, categoryName=%s, hints=%s → %s', (path, name, hints, expected) => {
    expect(mapEbayCategory(path, name, hints)).toBe(expected);
  });
});

// ── mapEbayConstraint ─────────────────────────────────────────────────────────

describe('mapEbayConstraint', () => {
  it('undefined aspects → undefined', () => {
    expect(mapEbayConstraint(undefined)).toBeUndefined();
  });

  it('empty aspects → undefined', () => {
    expect(mapEbayConstraint({})).toBeUndefined();
  });

  it('Parking Sensors: With → WITH_PARKING_SENSORS', () => {
    expect(mapEbayConstraint({ 'Parking Sensors': ['With'] })).toBe('WITH_PARKING_SENSORS');
  });

  it('Parking Sensors: Without → WITHOUT_PARKING_SENSORS', () => {
    expect(mapEbayConstraint({ 'Parking Sensors': ['Without'] })).toBe('WITHOUT_PARKING_SENSORS');
  });

  it('Drive Type: AWD → AWD', () => {
    expect(mapEbayConstraint({ 'Drive Type': ['AWD'] })).toBe('AWD');
  });

  it('Headlight Type: LED → LED', () => {
    expect(mapEbayConstraint({ 'Headlight Type': ['LED'] })).toBe('LED');
  });

  it('Backup Camera: With → WITH_CAMERA', () => {
    expect(mapEbayConstraint({ 'Backup Camera': ['With'] })).toBe('WITH_CAMERA');
  });
});
