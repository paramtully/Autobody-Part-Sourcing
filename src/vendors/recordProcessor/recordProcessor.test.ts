/**
 * Graph-integrity tests for DrizzleRecordProcessor.
 *
 * Each test gets a fresh pglite instance via createTestDb().
 * assertGraphIntact() runs in afterEach so any test that leaves an orphan row fails loudly.
 *
 * The module-level `testDb` variable is exposed through a getter on the @repo/db mock,
 * so the processor's top-level `import { db }` always resolves to the current test db.
 */

import { createTestDb, type TestDb } from '../../../test/setup/pgliteDb';
import { seedVendor, assertGraphIntact } from '../../../test/setup/seed';
import DrizzleRecordProcessor from './recordProcessor';
import type { VendorRecord } from '../clients/vendorRecord';

// ── @repo/db mock ─────────────────────────────────────────────────────────────
// The mock factory returns a plain mutable object. In beforeEach we assign the
// freshly-migrated test db onto it so recordProcessor's `import { db }` always
// resolves to the active pglite handle (ts-jest CJS compiles named imports as
// property accesses on the cached module object).

jest.mock('@repo/db', () => ({
  ...jest.requireActual('@repo/db'),
  db: null as unknown,
}));

let testDb: TestDb;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  testDb = await createTestDb();
  // Inject the fresh pglite db into the cached mock module object.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (require('@repo/db') as Record<string, unknown>)['db'] = testDb;
  await seedVendor(testDb, 'ebay');
});

afterEach(async () => {
  await assertGraphIntact(testDb);
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<VendorRecord> = {}): VendorRecord {
  return {
    part: { name: 'Front Bumper', category: 'BUMPER' },
    identifiers: [{ type: 'AFTERMARKET', value: 'MPN-001' }],
    fitments: [{ make: 'Honda', model: 'Civic', year: 2018 }],
    listing: {
      vendorListingExternalId: 'ITEM-001',
      condition: 'RECYCLED',
      availabilityStatus: 'IN_STOCK',
      priceMinorMin: 1000,
      currency: 'USD',
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DrizzleRecordProcessor.validateAndUpsert', () => {

  it('base — single new record creates 1 part / 1 identifier / 1 fitment / 1 listing', async () => {
    const processor = new DrizzleRecordProcessor();
    const result = await processor.validateAndUpsert([makeRecord()], 'ebay');

    // toMatchObject permits the additional `newParts` field the processor returns
    // for downstream Trading API fitment enrichment of newly created parts.
    expect(result).toMatchObject({ succeeded: 1, failed: 0, skipped: 0 });

    const partRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM parts`);
    expect(parseInt(partRes.rows[0]!.cnt, 10)).toBe(1);

    const piRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM part_identifiers`);
    expect(parseInt(piRes.rows[0]!.cnt, 10)).toBe(1);

    const fRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM fitments`);
    expect(parseInt(fRes.rows[0]!.cnt, 10)).toBe(1);

    const pfRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM part_fitments`);
    expect(parseInt(pfRes.rows[0]!.cnt, 10)).toBe(1);

    const lRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM listings`);
    expect(parseInt(lRes.rows[0]!.cnt, 10)).toBe(1);
  });

  it('idempotency — same record ingested twice yields 1 part / 1 listing', async () => {
    const processor = new DrizzleRecordProcessor();
    const record = makeRecord();

    await processor.validateAndUpsert([record], 'ebay');
    const result2 = await processor.validateAndUpsert([record], 'ebay');
    expect(result2.succeeded).toBe(1);
    expect(result2.failed).toBe(0);

    const lRes2 = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM listings`);
    expect(parseInt(lRes2.rows[0]!.cnt, 10)).toBe(1);

    const fRes2 = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM fitments`);
    expect(parseInt(fRes2.rows[0]!.cnt, 10)).toBe(1);
  });

  it('listing upsert updates price on re-ingest without duplicating rows', async () => {
    const processor = new DrizzleRecordProcessor();
    await processor.validateAndUpsert([makeRecord()], 'ebay');

    const updated = makeRecord({ listing: { ...makeRecord().listing, priceMinorMin: 1500 } });
    await processor.validateAndUpsert([updated], 'ebay');

    const priceRes = await testDb.execute<{ price_minor_min: number }>(
      `SELECT price_minor_min FROM listings`
    );
    expect(priceRes.rows).toHaveLength(1);
    expect(priceRes.rows[0]!.price_minor_min).toBe(1500);
  });

  it('two records sharing an identifier → 1 part, 1 identifier, 2 fitments, 2 listings', async () => {
    // Process in TWO batches so the second batch can see the already-existing identifier
    // and go through the "existing record" branch of validateRecords.
    const processor = new DrizzleRecordProcessor();
    const recordA = makeRecord({
      fitments: [{ make: 'Honda', model: 'Civic', year: 2018 }],
      listing: { ...makeRecord().listing, vendorListingExternalId: 'ITEM-A' },
    });
    const recordB = makeRecord({
      fitments: [{ make: 'Honda', model: 'Civic', year: 2019 }],
      listing: { ...makeRecord().listing, vendorListingExternalId: 'ITEM-B' },
    });

    const result1 = await processor.validateAndUpsert([recordA], 'ebay');
    expect(result1).toMatchObject({ succeeded: 1, failed: 0, skipped: 0 });

    const result2 = await processor.validateAndUpsert([recordB], 'ebay');
    expect(result2.succeeded).toBe(1);
    expect(result2.skipped).toBe(0);

    const pRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM parts`);
    expect(parseInt(pRes.rows[0]!.cnt, 10)).toBe(1);

    const piRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM part_identifiers`);
    expect(parseInt(piRes.rows[0]!.cnt, 10)).toBe(1);

    const fRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM fitments`);
    expect(parseInt(fRes.rows[0]!.cnt, 10)).toBe(2);

    const lRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM listings`);
    expect(parseInt(lRes.rows[0]!.cnt, 10)).toBe(2);
  });

  it('conflict — identifiers resolve to two different parts → record skipped', async () => {
    // Pre-seed two DISTINCT parts (different names) with distinct identifiers
    const processor = new DrizzleRecordProcessor();
    await processor.validateAndUpsert([
      makeRecord({
        part: { name: 'OEM Front Bumper', category: 'BUMPER' },
        identifiers: [{ type: 'OEM', value: 'OEM-111' }],
        listing: { ...makeRecord().listing, vendorListingExternalId: 'SEED-1' },
      }),
    ], 'ebay');
    await processor.validateAndUpsert([
      makeRecord({
        part: { name: 'OEM Rear Bumper', category: 'BUMPER' },
        identifiers: [{ type: 'OEM', value: 'OEM-222' }],
        listing: { ...makeRecord().listing, vendorListingExternalId: 'SEED-2' },
      }),
    ], 'ebay');

    // Now a record claiming BOTH identifiers — should be skipped
    const conflicting = makeRecord({
      identifiers: [
        { type: 'OEM', value: 'OEM-111' },
        { type: 'OEM', value: 'OEM-222' },
      ],
      listing: { ...makeRecord().listing, vendorListingExternalId: 'CONFLICT-1' },
    });
    const result = await processor.validateAndUpsert([conflicting], 'ebay');

    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);

    // Still only 2 listings from the seeding phase
    const lConflictRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM listings`);
    expect(parseInt(lConflictRes.rows[0]!.cnt, 10)).toBe(2);
  });

  it('new identifier appended to existing part without forking', async () => {
    const processor = new DrizzleRecordProcessor();

    // Seed a part with OEM:111
    await processor.validateAndUpsert([
      makeRecord({ identifiers: [{ type: 'OEM', value: 'OEM-111' }] }),
    ], 'ebay');

    // Same part, add AFTERMARKET:AFT-9
    await processor.validateAndUpsert([
      makeRecord({
        identifiers: [
          { type: 'OEM', value: 'OEM-111' },
          { type: 'AFTERMARKET', value: 'AFT-9' },
        ],
      }),
    ], 'ebay');

    const pRes2 = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM parts`);
    expect(parseInt(pRes2.rows[0]!.cnt, 10)).toBe(1);

    const piRes2 = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM part_identifiers`);
    expect(parseInt(piRes2.rows[0]!.cnt, 10)).toBe(2);
  });

  it('fitment dedup across batch — 5 records with same fitment yield 1 fitments row', async () => {
    const processor = new DrizzleRecordProcessor();
    // Each record needs a DISTINCT part (different name/category) so the processor
    // creates 5 distinct parts, all linked to the same fitment.
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord({
        part: { name: `Part Variant ${i}`, category: 'BUMPER' },
        identifiers: [{ type: 'AFTERMARKET', value: `MPN-${i}` }],
        fitments: [{ make: 'Honda', model: 'Civic', year: 2018 }],
        listing: { ...makeRecord().listing, vendorListingExternalId: `ITEM-${i}` },
      }),
    );

    const result = await processor.validateAndUpsert(records, 'ebay');
    expect(result.succeeded).toBe(5);

    const fDedupRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM fitments`);
    expect(parseInt(fDedupRes.rows[0]!.cnt, 10)).toBe(1);

    const pfDedupRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM part_fitments`);
    expect(parseInt(pfDedupRes.rows[0]!.cnt, 10)).toBe(5);
  });

  it('zero fitments — universal part succeeds with 0 part_fitments rows', async () => {
    const processor = new DrizzleRecordProcessor();
    const result = await processor.validateAndUpsert([makeRecord({ fitments: [] })], 'ebay');

    expect(result.succeeded).toBe(1);

    const pfZeroRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM part_fitments`);
    expect(parseInt(pfZeroRes.rows[0]!.cnt, 10)).toBe(0);
  });

  it('re-ingest after fitment row removed still links part_fitments (no stale prefetch ids)', async () => {
    const processor = new DrizzleRecordProcessor();
    const fitment = { make: 'Honda', model: 'Civic', year: 2018 };
    const record = makeRecord({ fitments: [fitment] });
    await processor.validateAndUpsert([record], 'ebay');

    await testDb.execute(`DELETE FROM part_fitments`);
    await testDb.execute(`DELETE FROM fitments`);

    const result = await processor.validateAndUpsert([record], 'ebay');
    expect(result.succeeded).toBe(1);

    const pfRes = await testDb.execute<{ cnt: string }>(`SELECT count(*)::text AS cnt FROM part_fitments`);
    expect(parseInt(pfRes.rows[0]!.cnt, 10)).toBe(1);
  });
});
