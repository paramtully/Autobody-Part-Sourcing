/**
 * API route tests: /fitment
 */

import express from 'express';
import request from 'supertest';
import { createTestDb, type TestDb } from '../../../test/setup/pgliteDb';
import { seedVendor, seedPart, seedFitment } from '../../../test/setup/seed';

// ── @repo/db mock ─────────────────────────────────────────────────────────────

jest.mock('@repo/db', () => ({
  ...jest.requireActual('@repo/db'),
  db: null as unknown,
}));

let testDb: TestDb;

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fitmentRouter = require('./fitment').default;
  app.use('/fitment', fitmentRouter);
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

// ── Enum smoke tests (no DB hit) ─────────────────────────────────────────────

describe('GET /fitment/categories', () => {
  it('returns a non-empty array of strings', async () => {
    const res = await request(app).get('/fitment/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories.length).toBeGreaterThan(0);
    expect(res.body.categories).toContain('BUMPER');
  });
});

describe('GET /fitment/positions', () => {
  it('returns a non-empty positions array', async () => {
    const res = await request(app).get('/fitment/positions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.positions)).toBe(true);
    expect(res.body.positions.length).toBeGreaterThan(0);
  });
});

describe('GET /fitment/constraints', () => {
  it('returns a non-empty constraints array', async () => {
    const res = await request(app).get('/fitment/constraints');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.constraints)).toBe(true);
    expect(res.body.constraints).toContain('AWD');
  });
});

// ── GET /fitment/makes-with-models ────────────────────────────────────────────

describe('GET /fitment/makes-with-models', () => {
  it('normal — groups models by make', async () => {
    await seedFitment(testDb, { make: 'Honda', model: 'Civic', year: 2018 });
    await seedFitment(testDb, { make: 'Honda', model: 'Accord', year: 2020 });
    await seedFitment(testDb, { make: 'Toyota', model: 'Camry', year: 2019 });

    const res = await request(app).get('/fitment/makes-with-models');
    expect(res.status).toBe(200);
    // seedFitment stores make/model uppercase to match the route's fitmentSchema transform
    expect(res.body['HONDA']).toEqual(expect.arrayContaining(['CIVIC', 'ACCORD']));
    expect(res.body['TOYOTA']).toEqual(expect.arrayContaining(['CAMRY']));
  });

  it('base — empty DB returns empty object', async () => {
    const res = await request(app).get('/fitment/makes-with-models');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

// ── GET /fitment/years ────────────────────────────────────────────────────────

describe('GET /fitment/years', () => {
  it('normal — returns distinct years', async () => {
    await seedFitment(testDb, { make: 'Honda', model: 'Civic', year: 2018 });
    await seedFitment(testDb, { make: 'Toyota', model: 'Camry', year: 2019 });
    await seedFitment(testDb, { make: 'Honda', model: 'Accord', year: 2019 }); // duplicate year

    const res = await request(app).get('/fitment/years');
    expect(res.status).toBe(200);
    const years: number[] = res.body.years;
    expect(years).toContain(2018);
    expect(years).toContain(2019);
    // No duplicates
    expect(new Set(years).size).toBe(years.length);
  });
});

// ── GET /fitment/:partId ──────────────────────────────────────────────────────

describe('GET /fitment/:partId', () => {
  it('base — part with no fitments returns empty array', async () => {
    const partId = await seedPart(testDb);
    const res = await request(app).get(`/fitment/${partId}`);
    expect(res.status).toBe(200);
    expect(res.body.fitments).toEqual([]);
  });

  it('normal — returns one row per distinct (make, model, year) for client-side range coalescing', async () => {
    const partId = await seedPart(testDb);
    const { partFitments } = await import('../../../src/db/models/parts');

    for (const year of [2018, 2019, 2020, 2021]) {
      const fitmentId = await seedFitment(testDb, { make: 'Honda', model: 'Civic', year });
      await testDb.insert(partFitments).values({ partId, fitmentId }).onConflictDoNothing();
    }

    const res = await request(app).get(`/fitment/${partId}`);
    expect(res.status).toBe(200);
    // Route returns raw per-year rows ordered by year DESC; client coalesces into ranges for display.
    expect(res.body.fitments).toHaveLength(4);
    expect(res.body.fitments.every((f: { make: string; model: string }) => f.make === 'HONDA' && f.model === 'CIVIC')).toBe(true);
    const years = res.body.fitments.map((f: { year: number }) => f.year);
    expect(years).toEqual([2021, 2020, 2019, 2018]);
  });
});
