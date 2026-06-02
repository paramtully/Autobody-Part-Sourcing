/**
 * API route tests: /listings
 *
 * Uses supertest against the Express router + pglite so the full request→SQL
 * path is exercised without a real Postgres instance.
 */

import express from 'express';
import request from 'supertest';
import { createTestDb, type TestDb } from '../../../test/setup/pgliteDb';
import { seedVendor, seedPart, seedFitment, seedListing } from '../../../test/setup/seed';

// ── @repo/db mock (redirect db to pglite) ────────────────────────────────────

jest.mock('@repo/db', () => ({
  ...jest.requireActual('@repo/db'),
  db: null as unknown,
}));

let testDb: TestDb;

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  // Import must happen AFTER the mock is installed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const listingsRouter = require('./listings').default;
  app.use('/listings', listingsRouter);
  return app;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let app: ReturnType<typeof makeApp>;

beforeEach(async () => {
  testDb = await createTestDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (require('@repo/db') as Record<string, unknown>)['db'] = testDb;
  await seedVendor(testDb);
  app = makeApp();
  jest.resetModules();
});

// ── GET /listings/by-fitment ─────────────────────────────────────────────────

describe('GET /listings/by-fitment', () => {
  it('base — empty DB returns empty listings', async () => {
    const res = await request(app)
      .get('/listings/by-fitment')
      .query({ make: 'Honda', model: 'Civic', year: '2018' });

    expect(res.status).toBe(200);
    expect(res.body.listings).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  });

  it('normal — returns listings matching make/model/year', async () => {
    const partId = await seedPart(testDb, {
      identifier: { type: 'AFTERMARKET', value: 'MPN-CIVIC-001' },
    });
    const fitmentId = await seedFitment(testDb, { make: 'Honda', model: 'Civic', year: 2018 });
    const { partFitments } = await import('../../../src/db/models/parts');
    await testDb.insert(partFitments).values({ partId, fitmentId }).onConflictDoNothing();

    const piRes = await testDb.execute<{ id: string }>(
      `SELECT id FROM part_identifiers WHERE value = 'MPNCIVIC001' LIMIT 1`
    );
    const piId = piRes.rows[0]!.id;

    await seedListing(testDb, { partIdentifierId: piId, externalId: 'ITEM-C1' });
    await seedListing(testDb, { partIdentifierId: piId, externalId: 'ITEM-C2' });

    const res = await request(app)
      .get('/listings/by-fitment')
      .query({ make: 'Honda', model: 'Civic', year: '2018' });

    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(2);
  });

  it('edge — invalid year returns 400', async () => {
    const res = await request(app)
      .get('/listings/by-fitment')
      .query({ make: 'Honda', model: 'Civic', year: 'not-a-year' });

    expect(res.status).toBe(400);
  });

  it('edge — missing required field (no model) returns 400', async () => {
    const res = await request(app)
      .get('/listings/by-fitment')
      .query({ make: 'Honda', year: '2018' });

    expect(res.status).toBe(400);
  });
});

// ── Affiliate decoration ─────────────────────────────────────────────────────

describe('affiliate sourceUrl decoration', () => {
  const CAMPID = '5338123456';
  const HASH_URL =
    'https://www.ebay.ca/itm/225790420905?hash=item34922867a9:g:zA0AAOSwCcZlL5T8';

  beforeAll(() => {
    process.env.EBAY_EPN_CAMPID = CAMPID;
  });

  afterAll(() => {
    delete process.env.EBAY_EPN_CAMPID;
  });

  beforeEach(async () => {
    jest.resetModules();
    testDb = await createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('@repo/db') as Record<string, unknown>)['db'] = testDb;
    await seedVendor(testDb, 'ebay-ca');
    app = makeApp();
  });

  it('wraps eBay listings with direct EPN params (not rover)', async () => {
    const partId = await seedPart(testDb, {
      identifier: { type: 'AFTERMARKET', value: 'AFF-EBAY-001' },
    });
    const fitmentId = await seedFitment(testDb, { make: 'Honda', model: 'Civic', year: 2018 });
    const { partFitments } = await import('../../../src/db/models/parts');
    await testDb.insert(partFitments).values({ partId, fitmentId }).onConflictDoNothing();

    const piRes = await testDb.execute<{ id: string }>(
      `SELECT id FROM part_identifiers WHERE value = 'AFFEBAY001' LIMIT 1`,
    );
    const piId = piRes.rows[0]!.id;
    await seedListing(testDb, {
      partIdentifierId: piId,
      externalId: 'AFF-ITEM-1',
      sourceUrl: HASH_URL,
    });

    const res = await request(app)
      .get('/listings/by-fitment')
      .query({ make: 'Honda', model: 'Civic', year: '2018' });

    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(1);
    const sourceUrl: string = res.body.listings[0].sourceUrl;
    expect(sourceUrl).not.toContain('rover.ebay.com');
    expect(sourceUrl).not.toContain('hash=');
    expect(sourceUrl).toContain('mkevt=1');
    expect(sourceUrl).toContain(`campid=${CAMPID}`);
    expect(sourceUrl).toContain('mkrid=706-53473-19255-0');
  });
});

// ── GET /listings/by-part-number/:partNumber ──────────────────────────────────

describe('GET /listings/by-part-number/:partNumber', () => {
  it('base — unknown partNumber returns 404', async () => {
    const res = await request(app).get('/listings/by-part-number/UNKNOWN-PART');
    expect(res.status).toBe(404);
  });

  it('normal — lowercased input is uppercased and matches', async () => {
    await seedPart(testDb, {
      identifier: { type: 'AFTERMARKET', value: 'ABC123' },
    });
    const piRes = await testDb.execute<{ id: string }>(
      `SELECT id FROM part_identifiers WHERE value = 'ABC123' LIMIT 1`
    );
    const piId = piRes.rows[0]!.id;
    await seedListing(testDb, { partIdentifierId: piId, externalId: 'ITEM-P1' });

    const res = await request(app).get('/listings/by-part-number/abc123');
    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(1);
  });

  it('edge — invalid cursor returns 400', async () => {
    const res = await request(app)
      .get('/listings/by-part-number/ABC123')
      .query({ cursor: 'not-a-valid-uuid' });
    expect(res.status).toBe(400);
  });

  it('edge — page above MAX_PAGES returns 400', async () => {
    const res = await request(app)
      .get('/listings/by-part-number/ABC123')
      .query({ page: '21' });
    expect(res.status).toBe(400);
  });
});

// ── GET /listings/images/:listingId ──────────────────────────────────────────

describe('GET /listings/images/:listingId', () => {
  it('base — listing with no images returns empty array', async () => {
    await seedPart(testDb, {
      identifier: { type: 'AFTERMARKET', value: 'IMG-001' },
    });
    const piRes1 = await testDb.execute<{ id: string }>(
      `SELECT id FROM part_identifiers WHERE value = 'IMG001' LIMIT 1`
    );
    const listingId = await seedListing(testDb, { partIdentifierId: piRes1.rows[0]!.id });

    const res = await request(app).get(`/listings/images/${listingId}`);
    expect(res.status).toBe(200);
    expect(res.body.listingImages).toEqual([]);
    expect(res.body.listingId).toBe(listingId);
  });

  it('normal — listing with images returns them ordered by sortOrder', async () => {
    await seedPart(testDb, {
      identifier: { type: 'AFTERMARKET', value: 'IMG-002' },
    });
    const piRes2 = await testDb.execute<{ id: string }>(
      `SELECT id FROM part_identifiers WHERE value = 'IMG002' LIMIT 1`
    );
    const listingId = await seedListing(testDb, { partIdentifierId: piRes2.rows[0]!.id });

    const { listingImages } = await import('../../../src/db/models/listings');
    await testDb.insert(listingImages).values([
      { url: 'https://example.com/img2.jpg', listingId, sortOrder: 1, imageType: 'ANGLE' },
      { url: 'https://example.com/img1.jpg', listingId, sortOrder: 0, imageType: 'PRIMARY' },
    ]);

    const res = await request(app).get(`/listings/images/${listingId}`);
    expect(res.status).toBe(200);
    expect(res.body.listingImages).toHaveLength(2);
    expect(res.body.listingImages[0].imageType).toBe('PRIMARY');
    expect(res.body.listingImages[1].imageType).toBe('ANGLE');
  });
});
