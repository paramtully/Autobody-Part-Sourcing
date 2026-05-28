import { eq, and, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { Db } from '../client';
import { ingestionRuns } from '../models/ingestion';

// ── Types ────────────────────────────────────────────────────────

export type IngestionRunRow = typeof ingestionRuns.$inferSelect;
export type IngestionRunInsert = typeof ingestionRuns.$inferInsert;

export interface IngestionStats {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  pagesFetched: number;
}

// ── Ingestion Run Repository ──────────────────────────────────────

export class IngestionRunRepo {
  constructor(private readonly db: Db) {}

  async findInProgress(vendorId: string): Promise<IngestionRunRow | null> {
    const [row] = await this.db
      .select()
      .from(ingestionRuns)
      .where(
        and(eq(ingestionRuns.vendorId, vendorId), eq(ingestionRuns.status, 'IN_PROGRESS')),
      );
    return row ?? null;
  }

  async findLatest(vendorId: string): Promise<IngestionRunRow | null> {
    const [row] = await this.db
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.vendorId, vendorId))
      .orderBy(desc(ingestionRuns.startedAt))
      .limit(1);
    return row ?? null;
  }

  async create(vendorId: string): Promise<IngestionRunRow> {
    const [row] = await this.db
      .insert(ingestionRuns)
      .values({ id: randomUUID(), vendorId, status: 'IN_PROGRESS' })
      .returning();
    return row;
  }

  async update(
    id: string,
    patch: {
      status?: IngestionRunRow['status'];
      lastCursor?: string | null;
      lastChunkAt?: Date;
      completedAt?: Date;
      stats?: IngestionStats;
      errorMessage?: string;
    },
  ): Promise<void> {
    await this.db
      .update(ingestionRuns)
      .set({
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.lastCursor !== undefined && { lastCursor: patch.lastCursor }),
        ...(patch.lastChunkAt !== undefined && { lastChunkAt: patch.lastChunkAt }),
        ...(patch.completedAt !== undefined && { completedAt: patch.completedAt }),
        ...(patch.stats !== undefined && { stats: patch.stats }),
        ...(patch.errorMessage !== undefined && { errorMessage: patch.errorMessage }),
      })
      .where(eq(ingestionRuns.id, id));
  }
}

// ── Composite ingestion repository ───────────────────────────────
// Passed into the ingestion pipeline so it has all DB access it needs.

export interface IngestionRepos {
  runs: IngestionRunRepo;
}
