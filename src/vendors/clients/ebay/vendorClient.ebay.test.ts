import eBayVendorClient from './vendorClient.ebay';
import { VendorError } from '../vendorError';
import {
  mapEbayCondition,
  mapEbayItemAvailability,
  mapEbayConstraint,
} from './schema.ebay.item';
import { mockFetchSequence, restoreFetch } from '../../../../test/setup/mockFetch';

const validItem = require('../../../../test/fixtures/ebay/itemDetail.valid.json');
const invalidItem = require('../../../../test/fixtures/ebay/itemDetail.invalid.json');
const nompnItem = require('../../../../test/fixtures/ebay/itemDetail.nompn.json');
const searchPage = require('../../../../test/fixtures/ebay/itemSummarySearch.json');
const oauthToken = require('../../../../test/fixtures/ebay/oauthToken.json');

afterEach(() => restoreFetch());

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeClient() {
  return new eBayVendorClient();
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
  it('vendorId is "ebay" and matches slug pattern', () => {
    const client = makeClient();
    expect(client.vendorId).toBe('ebay');
    expect(client.vendorId).toMatch(/^[a-z0-9-]+$/);
  });
});

// ── mapRecord ────────────────────────────────────────────────────────────────

describe('mapRecord', () => {
  it('happy path — maps a valid item to VendorRecord', () => {
    const client = makeClient();
    const record = client.mapRecord(validItem);

    expect(record.part.name).toBeTruthy();
    expect(record.identifiers.length).toBeGreaterThanOrEqual(1);
    expect(record.listing.vendorListingExternalId).toBe('v1|123456789|0');
    expect(record.listing.priceMinorMin).toBe(12999);  // "$129.99" → 12999 cents
    expect(record.listing.currency).toBe('USD');
    expect(['NEW_OEM', 'NEW_AFTERMARKET', 'RECYCLED', 'REMANUFACTURED', 'RECONDITIONED', 'UNKNOWN'])
      .toContain(record.listing.condition);
    expect(['IN_STOCK', 'LOW_STOCK', 'BACKORDER', 'SPECIAL_ORDER', 'UNKNOWN'])
      .toContain(record.listing.availabilityStatus);
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
    expect(record.fitments[0]).toMatchObject({ make: 'Honda', model: 'Civic', year: 2018 });
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
});

// ── fetchInventoryPage ────────────────────────────────────────────────────────

describe('fetchInventoryPage', () => {
  it('normal — returns records, hasMore: true, nextCursor from first page', async () => {
    // auth + search (has next) + 2 item detail calls
    authThenSearch([validItem, validItem]);
    const client = makeClient();
    const result = await client.fetchInventoryPage();

    expect(Array.isArray(result.records)).toBe(true);
    expect(result.records.length).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('200');
  });

  it('last page — hasMore: false when no next link', async () => {
    const lastPage = { ...searchPage, next: undefined };
    mockFetchSequence([
      { body: oauthToken },
      { body: lastPage },
      { body: validItem },
      { body: validItem },
    ]);
    const client = makeClient();
    const result = await client.fetchInventoryPage('200');
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it('empty itemSummaries — throws VendorError(INVALID_REQUEST)', async () => {
    mockFetchSequence([
      { body: oauthToken },
      { body: { ...searchPage, itemSummaries: [] } },
    ]);
    const client = makeClient();
    await expect(client.fetchInventoryPage()).rejects.toMatchObject({
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
