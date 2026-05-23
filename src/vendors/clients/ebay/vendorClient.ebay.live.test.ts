/**
 * Live smoke test — skipped by default.
 * Run with: LIVE_TESTS=1 npm test -- --testPathPattern=vendorClient.ebay.live
 *
 * Requires real credentials (sandbox or production) in your .env:
 *   EBAY_API_KEY, EBAY_API_SECRET
 *   EBAY_API_URL (optional — defaults to https://api.ebay.com; use https://api.sandbox.ebay.com for sandbox)
 *
 * Trading API bootstrap (one-time, to obtain EBAY_USER_REFRESH_TOKEN):
 *   1. Configure a RuName in the eBay dev portal and set EBAY_RU_NAME in .env
 *   2. LIVE_TESTS=1 npm test -- --testPathPattern=vendorClient.ebay.live -t "bootstrap"
 *      → prints a consent URL; open it, log in, and copy ?code=... from the redirect
 *   3. LIVE_TESTS=1 EBAY_BOOTSTRAP_CODE=<code> npm test -- --testPathPattern=vendorClient.ebay.live -t "bootstrap"
 *      → prints EBAY_USER_REFRESH_TOKEN=...; paste into .env
 */

jest.setTimeout(30_000);

import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
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

  it('eBay user-OAuth bootstrap (consent URL + code exchange)', async () => {
    const ruName = process.env['EBAY_RU_NAME'];
    if (!ruName) throw new Error('Set EBAY_RU_NAME in .env first (see file comment above)');

    const code = process.env['EBAY_BOOTSTRAP_CODE'];
    const { apiKey, apiSecret, apiUrl } = client.config;

    if (!code) {
      const consent = 'https://auth.ebay.com/oauth2/authorize?' + new URLSearchParams({
        client_id: apiKey,
        response_type: 'code',
        redirect_uri: ruName,
        scope: 'https://api.ebay.com/oauth/api_scope',
      });
      console.log('\nOpen this URL, consent, then capture ?code=... from the redirect:\n');
      console.log(consent + '\n');
      console.log('Then re-run with: EBAY_BOOTSTRAP_CODE=<code> LIVE_TESTS=1 npm test -- --testPathPattern=vendorClient.ebay.live -t "bootstrap"\n');
      return;
    }

    const res = await fetch(`${apiUrl}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: decodeURIComponent(code),
        redirect_uri: ruName,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`exchange failed (${res.status}): ${JSON.stringify(body)}`);

    console.log('\n=== PASTE INTO .env ===');
    console.log(`EBAY_USER_REFRESH_TOKEN=${body.refresh_token}`);
    console.log(`# access_token (debug, expires_in=${body.expires_in}s): ${body.access_token}`);
    console.log(`# refresh_token_expires_in: ${body.refresh_token_expires_in}\n`);

    expect(body.refresh_token).toBeTruthy();
  }, 30_000);

  it('dumps raw Browse + Trading API samples for 10 items', async () => {
    const outDir = path.resolve(__dirname, '../../../../test/fixtures/ebay/live');
    fs.mkdirSync(outDir, { recursive: true });

    await client.getAuthStatus();
    const appToken = client.config.token!;
    const userToken = await client.authenticateUser();
    const apiUrl = client.config.apiUrl;
    const tradingApiUrl = apiUrl.replace('api.sandbox.ebay.com', 'api.ebay.com');

    if (!userToken) {
      console.warn('\n[dump] EBAY_USER_REFRESH_TOKEN not set — Trading API columns will show n/a. Run the bootstrap test first.\n');
    }

    // 1) Search — same query the listing worker uses
    const searchRes = await fetch(
      `${apiUrl}/buy/browse/v1/item_summary/search?` +
        new URLSearchParams({ q: 'auto body part', category_ids: '6028', limit: '10' }),
      { headers: { Authorization: `Bearer ${appToken}` } },
    );
    const search = await searchRes.json();
    fs.writeFileSync(path.join(outDir, '_search.json'), JSON.stringify(search, null, 2));

    const xmlParser = new XMLParser({ ignoreAttributes: true, isArray: (n) => n === 'Compatibility' || n === 'NameValueList' });

    const rows: string[] = [
      '| itemId | title | brand | product.brand | condition | categoryPath | aspect keys | compatProps | trading status | trading Ack | trading compat count |',
      '|---|---|---|---|---|---|---|---|---|---|---|',
    ];

    for (const s of search.itemSummaries ?? []) {
      const itemId: string = s.itemId;
      const legacyItemId: string | undefined = s.legacyItemId;

      // 2) Browse GetItem with PRODUCT fieldgroup (COMPATIBILITY is rejected by this app's scope)
      const browseRes = await fetch(
        `${apiUrl}/buy/browse/v1/item/${encodeURIComponent(itemId)}?fieldgroups=PRODUCT`,
        { headers: { Authorization: `Bearer ${appToken}` } },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const browseJson: any = browseRes.ok
        ? await browseRes.json()
        : { _httpStatus: browseRes.status, _body: await browseRes.text() };
      const safeId = itemId.replace(/[^a-z0-9]/gi, '_');
      fs.writeFileSync(path.join(outDir, `${safeId}.browse.json`), JSON.stringify(browseJson, null, 2));

      // 3) Trading API GetItem — raw XML + parsed JSON (requires user token)
      let tradingStatus = 'n/a';
      let ack = 'n/a';
      let compatCount = 0;

      if (legacyItemId && userToken) {
        const xmlBody = `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${legacyItemId}</ItemID><IncludeItemCompatibilityList>true</IncludeItemCompatibilityList><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>`;
        const tradingRes = await fetch(`${tradingApiUrl}/ws/api.dll`, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml',
            'X-EBAY-API-CALL-NAME': 'GetItem',
            'X-EBAY-API-COMPATIBILITY-LEVEL': '1193',
            'X-EBAY-API-SITEID': '100',
            'X-EBAY-API-IAF-TOKEN': userToken,
          },
          body: xmlBody,
        });
        tradingStatus = String(tradingRes.status);
        const xmlText = await tradingRes.text();
        fs.writeFileSync(path.join(outDir, `${legacyItemId}.trading.xml`), xmlText);
        const parsed = xmlParser.parse(xmlText);
        fs.writeFileSync(path.join(outDir, `${legacyItemId}.trading.parsed.json`), JSON.stringify(parsed, null, 2));
        ack = parsed?.GetItemResponse?.Ack ?? 'n/a';
        compatCount = (parsed?.GetItemResponse?.Item?.ItemCompatibilityList?.Compatibility ?? []).length;
      }

      const title = String(browseJson.title ?? '').slice(0, 60);
      const brand = String(browseJson.brand ?? '');
      const productBrand = String(browseJson.product?.brand ?? '');
      const condition = String(browseJson.condition ?? '');
      const categoryPath = String(browseJson.categoryPath ?? '').slice(0, 40);
      const aspectKeys = Object.keys(browseJson.product?.aspects ?? {}).join(', ').slice(0, 80);
      const numCompatProps = (browseJson.compatibilityProperties ?? []).length;

      rows.push(
        `| ${itemId} | ${title} | ${brand} | ${productBrand} | ${condition} | ${categoryPath} | ${aspectKeys} | ${numCompatProps} | ${tradingStatus} | ${ack} | ${compatCount} |`,
      );
    }

    fs.writeFileSync(path.join(outDir, '_INDEX.md'), rows.join('\n') + '\n');
    console.log(`\nDumped ${(search.itemSummaries ?? []).length} items → ${outDir}\n`);

    // Not asserting on content — this test is a diagnostic dump, not a correctness check.
    expect(true).toBe(true);
  }, 120_000);
});
