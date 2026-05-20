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

await db.insert(vendors).values({
  id: 'ebay',
  name: 'eBay',
  vendorType: 'MARKETPLACE',
  integrationType: 'API',
}).onConflictDoNothing();

console.log('Seed complete.');
process.exit(0);
