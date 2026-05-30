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

/** Supabase direct host — IPv6-only; fails on GitHub Actions and other IPv4-only networks. */
function isSupabaseDirectUrl(url: string): boolean {
    return /@db\.[^./]+\.supabase\.co/.test(url);
}

live('DB live smoke', () => {
    beforeAll(() => {
        const url = process.env['DATABASE_URL'] ?? '';
        if (url && isSupabaseDirectUrl(url)) {
            throw new Error(
                'DATABASE_URL uses Supabase direct connection (db.<ref>.supabase.co), which is IPv6-only. ' +
                    'Use a Supavisor pooler URL from Supabase Dashboard → Connect (session or transaction pooler).',
            );
        }
    });
    it('responds to SELECT 1', async () => {
        const result = await db.execute(sql`SELECT 1 AS ok`);
        expect(result[0]).toMatchObject({ ok: 1 });
    });

    it('vendors table is reachable and contains at least one row', async () => {
        const rows = await db.select().from(vendors).limit(1);
        expect(Array.isArray(rows)).toBe(true);
        expect(rows.length).toBeGreaterThan(0);
    });

    it('vendors table contains the expected ebay vendors', async () => {
        const { inArray } = await import('drizzle-orm');
        const rows = await db
            .select()
            .from(vendors)
            .where(inArray(vendors.id, ['ebay-us', 'ebay-ca']));
        expect(rows.length).toBe(2);
        for (const row of rows) {
            expect(row.name).toBe('eBay');
        }
    });
});
