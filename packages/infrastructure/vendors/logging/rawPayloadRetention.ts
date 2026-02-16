/**
 * Raw Payload Retention Cleanup
 *
 * Deletes expired raw payloads to bound storage growth.
 * Designed to be called by a periodic cron job (e.g. weekly).
 *
 * Strategy:
 * 1. Delete rows where retainUntil < NOW() in batches (to avoid long-running txns)
 * 2. Respects a maximum batch size to keep execution time within serverless limits
 * 3. Returns stats for monitoring and alerting
 *
 * Supabase Postgres sizing context:
 * - Free tier: 500MB database
 * - Pro tier ($25/mo): 8GB included, then $0.125/GB
 * - With 30-day retention + skip-unchanged optimization,
 *   typical storage stays under 1GB even with 3 vendors × 50K listings
 */

/**
 * Repository interface for retention cleanup.
 * Kept minimal — only what the cleanup needs.
 */
export interface RetentionCleanupStore {
  /**
   * Delete raw payloads where retainUntil < NOW().
   *
   * @param batchSize - Maximum rows to delete in one call
   * @returns Number of rows actually deleted
   */
  deleteExpired(batchSize: number): Promise<number>;

  /**
   * Count raw payloads that are expired but not yet deleted.
   * Used for monitoring/alerting before running cleanup.
   */
  countExpired(): Promise<number>;

  /**
   * Get total storage size of the raw_payloads table in bytes.
   * Uses pg_total_relation_size() for accurate size including indexes.
   */
  getTableSizeBytes(): Promise<number>;
}

/**
 * Configuration for the retention cleanup job.
 */
export interface RetentionCleanupConfig {
  /** Maximum rows to delete per invocation (default: 10_000). */
  readonly batchSize: number;

  /**
   * If true, keep running batches until no more expired rows remain.
   * If false, delete one batch and return (suitable for short-lived serverless).
   * Default: false.
   */
  readonly drainAll: boolean;

  /**
   * Maximum duration in ms for the entire cleanup job.
   * Acts as a safeguard for serverless timeout limits.
   * Default: 30_000 (30 seconds, well within Vercel's 300s limit).
   */
  readonly maxDurationMs: number;
}

const DEFAULT_CLEANUP_CONFIG: RetentionCleanupConfig = {
  batchSize: 10_000,
  drainAll: false,
  maxDurationMs: 30_000,
};

/**
 * Result of a retention cleanup run.
 */
export interface RetentionCleanupResult {
  /** Total rows deleted across all batches. */
  readonly totalDeleted: number;

  /** Number of batches executed. */
  readonly batchesExecuted: number;

  /** Whether there are still expired rows remaining. */
  readonly hasMore: boolean;

  /** Duration of the cleanup job in milliseconds. */
  readonly durationMs: number;

  /** Estimated table size in bytes after cleanup (if available). */
  readonly tableSizeBytesAfter?: number;
}

/**
 * Run retention cleanup on the raw_payloads table.
 *
 * @param store - Repository for deletion operations
 * @param config - Cleanup configuration (optional, uses defaults)
 * @returns Cleanup result with stats
 */
export async function cleanupExpiredPayloads(
  store: RetentionCleanupStore,
  config?: Partial<RetentionCleanupConfig>
): Promise<RetentionCleanupResult> {
  const cfg = { ...DEFAULT_CLEANUP_CONFIG, ...config };
  const startTime = Date.now();

  let totalDeleted = 0;
  let batchesExecuted = 0;
  let hasMore = true;

  while (hasMore) {
    // Check timeout
    if (Date.now() - startTime >= cfg.maxDurationMs) {
      break;
    }

    const deleted = await store.deleteExpired(cfg.batchSize);
    batchesExecuted++;
    totalDeleted += deleted;

    // If we deleted fewer than batchSize, there are no more expired rows
    hasMore = deleted >= cfg.batchSize;

    // If not draining all, stop after one batch
    if (!cfg.drainAll) {
      break;
    }
  }

  // Get table size after cleanup for monitoring
  let tableSizeBytesAfter: number | undefined;
  try {
    tableSizeBytesAfter = await store.getTableSizeBytes();
  } catch {
    // Non-critical — monitoring only
  }

  return {
    totalDeleted,
    batchesExecuted,
    hasMore,
    durationMs: Date.now() - startTime,
    tableSizeBytesAfter,
  };
}
