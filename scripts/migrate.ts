/**
 * Apply Drizzle SQL migrations in CI/production.
 *
 * Databases bootstrapped with `drizzle-kit push` have the schema but an empty
 * `drizzle.__drizzle_migrations` table. We record 0000 as applied when `vendors`
 * exists and the journal is empty, then run `drizzle-kit migrate` for the rest.
 */

import 'dotenv/config';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = 'src/db/migrations';
const BASELINE_TAG = '0000_absent_gorilla_man';

/** Drizzle applies migrations with `created_at` > last row; fix push-era baselines. */
async function repairBaselineTimestamp(sql: postgres.Sql): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  if (migrations.length < 2) return;

  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
  `;
  if (count !== 1) return;

  const [last] = await sql`
    SELECT created_at::text AS created_at, hash
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (!last || Number(last.created_at) < migrations[1].folderMillis) return;

  await sql`
    UPDATE drizzle.__drizzle_migrations
    SET created_at = ${migrations[0].folderMillis}
    WHERE hash = ${migrations[0].hash}
  `;
  console.log('Adjusted baseline migration timestamp (journal ordering)');
}

async function baselinePushSchemaIfNeeded(sql: postgres.Sql): Promise<void> {
  const [{ exists: hasVendors }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'vendors'
    ) AS exists
  `;
  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
  `;
  if (!hasVendors || count > 0) return;

  const journal = JSON.parse(
    readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, 'utf8'),
  ) as { entries: { tag: string; when: number }[] };
  const entry = journal.entries.find((e) => e.tag === BASELINE_TAG);
  if (!entry) throw new Error(`Missing journal entry for ${BASELINE_TAG}`);

  const baseline = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })[0];
  await sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${baseline.hash}, ${entry.when})
  `;
  console.log(`Baselined ${BASELINE_TAG} (push schema, empty migration journal)`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const sql = postgres(url);
  try {
    await baselinePushSchemaIfNeeded(sql);
    await repairBaselineTimestamp(sql);
  } finally {
    await sql.end();
  }

  execSync('npx drizzle-kit migrate', { stdio: 'inherit', env: process.env });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
