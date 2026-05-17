/**
 * Live smoke test — skipped by default.
 * Run with: LIVE_TESTS=1 npm test -- --testPathPattern=vendorClient.ebay.live
 *
 * Requires real credentials (sandbox or production) in your .env:
 *   EBAY_API_KEY, EBAY_API_SECRET
 *   EBAY_API_URL (optional — defaults to https://api.ebay.com; use https://api.sandbox.ebay.com for sandbox)
 */

jest.setTimeout(30_000);

import eBayVendorClient from './vendorClient.ebay';

const live = process.env['LIVE_TESTS'] === '1' ? describe : describe.skip;

live('eBay live smoke', () => {
  let client: eBayVendorClient;

  beforeAll(() => {
    client = new eBayVendorClient();
  });

  it('getAuthStatus() returns valid=true with a future expiresAt', async () => {
    const status = await client.getAuthStatus();
    expect(status.valid).toBe(true);
    expect(status.expiresAt).toBeInstanceOf(Date);
    expect(status.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('fetchInventoryPage() returns at least 1 raw record and a nextCursor', async () => {
    const page = await client.fetchInventoryPage();
    expect(Array.isArray(page.records)).toBe(true);
    expect(page.records.length).toBeGreaterThan(0);
    // nextCursor may be undefined on the only/last page, but should be a string when hasMore
    if (page.hasMore) {
      expect(typeof page.nextCursor).toBe('string');
    }
  });

  it('mapRecord(records[0]) returns a well-shaped VendorRecord', async () => {
    const page = await client.fetchInventoryPage();
    const raw = page.records[0];
    const record = client.mapRecord(raw);

    expect(record.part.name).toBeTruthy();
    expect(record.identifiers.length).toBeGreaterThanOrEqual(1);
    expect(record.identifiers[0]!.value).toBeTruthy();
    expect(record.listing.vendorListingExternalId).toBeTruthy();
    expect(record.listing.priceMinorMin).toBeGreaterThanOrEqual(0);
    expect(['NEW_OEM', 'NEW_AFTERMARKET', 'RECYCLED', 'REMANUFACTURED', 'RECONDITIONED', 'UNKNOWN'])
      .toContain(record.listing.condition);
    expect(['IN_STOCK', 'LOW_STOCK', 'BACKORDER', 'SPECIAL_ORDER', 'UNKNOWN'])
      .toContain(record.listing.availabilityStatus);
  });
});
