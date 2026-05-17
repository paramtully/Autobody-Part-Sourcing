import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as schema from '../../src/db/models/index';

const MIGRATION_PATH = join(__dirname, '../../src/db/migrations/0000_absent_gorilla_man.sql');

/**
 * Creates a fresh in-memory pglite database with the full schema applied.
 * Each call returns an isolated instance — safe to use in parallel test files.
 */
export async function createTestDb() {
  const pglite = new PGlite();
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  // drizzle-kit uses '--> statement-breakpoint' as a separator between DDL statements
  const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
  for (const statement of statements) {
    await pglite.exec(statement);
  }

  return drizzle(pglite, { schema });
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
