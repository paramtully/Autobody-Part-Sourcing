/**
 * Ingestion run types for checkpoint/resume and run ledger.
 *
 * Each pipeline invocation creates or resumes an IngestionRun.
 * The run tracks:
 * - Which vendor is being ingested
 * - Where in the pagination we are (cursor)
 * - How many records have been processed/succeeded/failed/skipped
 * - Whether the run is still in progress or completed
 *
 * This enables chunked execution on serverless (Vercel Cron):
 * each invocation processes one page, saves the cursor, and returns.
 */

/**
 * Status of an ingestion run.
 */
export type IngestionRunStatus =
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Statistics for an ingestion run.
 */
export interface IngestionRunStats {
  /** Total records processed in this run. */
  processed: number;

  /** Records successfully ingested. */
  succeeded: number;

  /** Records that failed validation or reconciliation. */
  failed: number;

  /** Records skipped (unchanged hash). */
  skipped: number;

  /** Records with conflicts. */
  conflicted: number;

  /** Total pages/chunks fetched. */
  pagesFetched: number;
}

/**
 * An ingestion run record.
 *
 * Stored in the `ingestion_runs` table for checkpoint/resume
 * and operational monitoring.
 */
export interface IngestionRun {
  /** UUID primary key. */
  readonly id: string;

  /** Vendor being ingested. */
  readonly vendorId: string;

  /** Current run status. */
  status: IngestionRunStatus;

  /** Pagination cursor for the next page (null if starting fresh). */
  lastCursor: string | null;

  /** When this run was created. */
  readonly startedAt: string;

  /** When the last chunk was processed. */
  lastChunkAt: string | null;

  /** When this run completed (null if still in progress). */
  completedAt: string | null;

  /** Accumulated statistics. */
  stats: IngestionRunStats;

  /** Error message if the run failed. */
  errorMessage: string | null;
}

/**
 * Create a new ingestion run.
 */
export function createIngestionRun(id: string, vendorId: string): IngestionRun {
  return {
    id,
    vendorId,
    status: 'IN_PROGRESS',
    lastCursor: null,
    startedAt: new Date().toISOString(),
    lastChunkAt: null,
    completedAt: null,
    stats: {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      conflicted: 0,
      pagesFetched: 0,
    },
    errorMessage: null,
  };
}

/**
 * Repository interface for ingestion run persistence.
 */
export interface IngestionRunRepository {
  /**
   * Find the most recent in-progress run for a vendor.
   * Used by the orchestrator to resume from where it left off.
   */
  findInProgressRun(vendorId: string): Promise<IngestionRun | null>;

  /**
   * Create a new ingestion run.
   */
  createRun(run: IngestionRun): Promise<void>;

  /**
   * Update an existing run (cursor, stats, status).
   */
  updateRun(run: IngestionRun): Promise<void>;

  /**
   * Find the most recent completed run for a vendor.
   * Used for monitoring and SLO tracking.
   */
  findLastCompletedRun(vendorId: string): Promise<IngestionRun | null>;
}

/**
 * Merge chunk stats into a run's cumulative stats.
 */
export function mergeChunkStats(
  run: IngestionRun,
  chunkStats: Partial<IngestionRunStats>
): void {
  run.stats.processed += chunkStats.processed ?? 0;
  run.stats.succeeded += chunkStats.succeeded ?? 0;
  run.stats.failed += chunkStats.failed ?? 0;
  run.stats.skipped += chunkStats.skipped ?? 0;
  run.stats.conflicted += chunkStats.conflicted ?? 0;
  run.stats.pagesFetched += chunkStats.pagesFetched ?? 0;
  run.lastChunkAt = new Date().toISOString();
}
