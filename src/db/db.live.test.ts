/**
 * Live smoke test — skipped by default.
 * Run with: LIVE_TESTS=1 npm test -- --testPathPattern=db.live
 *
 * Requires a real DATABASE_URL in your .env pointing to a live Postgres instance.
 */

jest.setTimeout(15_000);

import * as dotenv from 'dotenv';
dotenv.config();

import { sql } from 'drizzle-orm';
import { db } from './client';
import { vendors } from './models/vendors';

const live = process.env['LIVE_TESTS'] === '1' ? describe : describe.skip;

live('DB live smoke', () => {
    it('responds to SELECT 1', async () => {
        const result = await db.execute(sql`SELECT 1 AS ok`);
        expect(result[0]).toMatchObject({ ok: 1 });
    });

    it('vendors table is reachable and contains at least one row', async () => {
        const rows = await db.select().from(vendors).limit(1);
        expect(Array.isArray(rows)).toBe(true);
        expect(rows.length).toBeGreaterThan(0);
    });

    it('vendors table contains the expected ebay vendor', async () => {
        const { eq } = await import('drizzle-orm');
        const rows = await db.select().from(vendors).where(eq(vendors.id, 'ebay'));
        expect(rows.length).toBe(1);
        expect(rows[0]!.name).toBeTruthy();
    });
});
