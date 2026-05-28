import { eq, count } from 'drizzle-orm';
import { vendors, parts, partIdentifiers, fitments, partFitments, listings } from '../../src/db/models/index';
import { normalizePartIdentifierValue } from '../../src/db/schema/partIdentifier.schema';
import type { TestDb } from './pgliteDb';

// ── Seed helpers ──────────────────────────────────────────────────────────────

export async function seedVendor(db: TestDb, id = 'ebay-ca') {
  await db.insert(vendors).values({
    id,
    name: id.startsWith('ebay') ? 'eBay' : id,
    vendorType: 'MARKETPLACE',
    integrationType: 'API',
    orderingMode: 'NOT_SUPPORTED',
    supportsCancellation: false,
    supportsStatusLookup: false,
  }).onConflictDoNothing();
  return id;
}

export async function seedPart(
  db: TestDb,
  opts: {
    name?: string;
    category?: typeof parts.$inferInsert['category'];
    identifier?: { type: typeof partIdentifiers.$inferInsert['type']; value: string };
  } = {},
) {
  const name = opts.name ?? 'Test Headlight';
  const category = opts.category ?? 'HEADLIGHT';

  const [part] = await db
    .insert(parts)
    .values({ name, category })
    .returning({ id: parts.id });

  if (!part) throw new Error('seedPart: insert returned no row');

  if (opts.identifier) {
    await db.insert(partIdentifiers).values({
      partId: part.id,
      type: opts.identifier.type,
      value: normalizePartIdentifierValue(opts.identifier.value),
    });
  }

  return part.id;
}

export async function seedFitment(
  db: TestDb,
  opts: { make?: string; model?: string; year?: number } = {},
) {
  // Store make/model uppercase to match the route's fitmentSchema transform.
  const make = (opts.make ?? 'Honda').toUpperCase();
  const model = (opts.model ?? 'Civic').toUpperCase();
  const year = opts.year ?? 2018;

  const [fitment] = await db
    .insert(fitments)
    .values({ make, model, year })
    .onConflictDoNothing()
    .returning({ id: fitments.id });

  if (!fitment) {
    const [existing] = await db
      .select({ id: fitments.id })
      .from(fitments)
      .where(eq(fitments.make, make))
      .limit(1);
    return existing!.id;
  }
  return fitment.id;
}

export async function seedListing(
  db: TestDb,
  opts: {
    vendorId?: string;
    partIdentifierId: string;
    externalId?: string;
    priceMinorMin?: number;
  },
) {
  const [row] = await db
    .insert(listings)
    .values({
      vendorId: opts.vendorId ?? 'ebay-ca',
      partIdentifierId: opts.partIdentifierId,
      vendorListingExternalId: opts.externalId ?? `ITEM-${Date.now()}-${Math.random()}`,
      condition: 'RECYCLED',
      availabilityStatus: 'IN_STOCK',
      priceMinorMin: opts.priceMinorMin ?? 1000,
      currency: 'USD',
      source: 'VENDOR_API',
      lastSeenAt: new Date(),
      lastVerifiedAt: new Date(),
    })
    .returning({ id: listings.id });

  if (!row) throw new Error('seedListing: insert returned no row');
  return row.id;
}

// ── Graph integrity assertion ─────────────────────────────────────────────────

/**
 * Verifies the referential invariants of the part/partIdentifier/fitment graph.
 * Call in afterEach to catch any mutation that breaks foreign-key semantics at
 * the application layer (pglite enforces FKs, but this also catches logic bugs
 * that pglite might not surface with its partial FK support).
 */
export async function assertGraphIntact(db: TestDb) {
  // Every listing must reference an existing partIdentifier
  const orphanListings = await db.execute<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM listings l
     WHERE NOT EXISTS (SELECT 1 FROM part_identifiers pi WHERE pi.id = l.part_identifier_id)`,
  );
  const orphanListingCount = parseInt((orphanListings.rows[0] as { cnt: string }).cnt, 10);
  expect(orphanListingCount).toBe(0);

  // Every partIdentifier must reference an existing part
  const orphanIdentifiers = await db.execute<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM part_identifiers pi
     WHERE NOT EXISTS (SELECT 1 FROM parts p WHERE p.id = pi.part_id)`,
  );
  const orphanIdentifierCount = parseInt((orphanIdentifiers.rows[0] as { cnt: string }).cnt, 10);
  expect(orphanIdentifierCount).toBe(0);

  // Every part_fitments row must reference existing part and fitment
  const orphanPartFitments = await db.execute<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM part_fitments pf
     WHERE NOT EXISTS (SELECT 1 FROM parts p WHERE p.id = pf.part_id)
        OR NOT EXISTS (SELECT 1 FROM fitments f WHERE f.id = pf.fitment_id)`,
  );
  const orphanPFCount = parseInt((orphanPartFitments.rows[0] as { cnt: string }).cnt, 10);
  expect(orphanPFCount).toBe(0);

  // Every listing must reference an existing vendor
  const orphanVendorRefs = await db.execute<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM listings l
     WHERE NOT EXISTS (SELECT 1 FROM vendors v WHERE v.id = l.vendor_id)`,
  );
  const orphanVendorCount = parseInt((orphanVendorRefs.rows[0] as { cnt: string }).cnt, 10);
  expect(orphanVendorCount).toBe(0);
}
