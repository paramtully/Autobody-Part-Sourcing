import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as schema from '../../src/db/models/index';

const MIGRATIONS_DIR = join(__dirname, '../../src/db/migrations');

/**
 * Creates a fresh in-memory pglite database with the full schema applied.
 * Each call returns an isolated instance — safe to use in parallel test files.
 */
export async function createTestDb() {
  const pglite = new PGlite();

  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const migrationSql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // drizzle-kit uses '--> statement-breakpoint' as a separator between DDL statements
    const statements = migrationSql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
    for (const statement of statements) {
      await pglite.exec(statement);
    }
  }

  return drizzle(pglite, { schema });
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
