/**
 * One-time seed script — safe to re-run (all inserts use onConflictDoNothing).
 *
 * Usage:
 *   npm run seed
 *
 * Run this once after `npx drizzle-kit push` to populate reference data.
 */

import 'dotenv/config';
import { db, vendors } from '../src/db/index.ts';

// ── Vendors ───────────────────────────────────────────────────────────────────

(async () => {
  const ebayCommon = { name: 'eBay', vendorType: 'MARKETPLACE' as const, integrationType: 'API' as const };
  await db.insert(vendors).values([
    { id: 'ebay-us', ...ebayCommon },
    { id: 'ebay-ca', ...ebayCommon },
  ]).onConflictDoNothing();

  console.log('Seed complete.');
  process.exit(0);
})();
