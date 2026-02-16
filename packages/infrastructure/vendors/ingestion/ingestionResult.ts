/**
 * Refined ingestion result types for the orchestrator.
 *
 * Each chunk invocation returns an IngestionChunkResult.
 * Completed runs return an IngestionRunResult with full stats.
 */

import type { IngestionRunStats } from './ingestionRun';

/**
 * Result of processing a single chunk (one cron invocation).
 */
export interface IngestionChunkResult {
  /** The ingestion run ID this chunk belongs to. */
  readonly runId: string;

  /** Vendor being ingested. */
  readonly vendorId: string;

  /** Whether there are more pages to fetch. */
  readonly hasMore: boolean;

  /** The cursor for the next page (null if completed). */
  readonly nextCursor: string | null;

  /** Stats for this chunk only. */
  readonly chunkStats: IngestionRunStats;

  /** Whether the chunk succeeded or encountered an error. */
  readonly status: 'SUCCESS' | 'ERROR';

  /** Error message if the chunk failed. */
  readonly error?: string;

  /** Duration of this chunk in milliseconds. */
  readonly durationMs: number;
}

/**
 * Result of a completed ingestion run (all pages fetched).
 */
export interface IngestionRunResult {
  /** The ingestion run ID. */
  readonly runId: string;

  /** Vendor that was ingested. */
  readonly vendorId: string;

  /** Final run status. */
  readonly status: 'COMPLETED' | 'FAILED';

  /** Cumulative stats across all chunks. */
  readonly totalStats: IngestionRunStats;

  /** When the run started. */
  readonly startedAt: string;

  /** When the run completed. */
  readonly completedAt: string;

  /** Total duration in milliseconds. */
  readonly totalDurationMs: number;

  /** Error message if the run failed. */
  readonly error?: string;
}

/**
 * Per-record processing result for detailed monitoring.
 */
export interface RecordProcessingResult {
  /** The vendor listing external ID. */
  readonly vendorListingExternalId?: string;

  /** What action was taken. */
  readonly action: 'INSERTED' | 'UPDATED' | 'SKIPPED' | 'CONFLICTED' | 'FAILED';

  /** Error message if the record failed. */
  readonly error?: string;

  /** Duration of processing this record in milliseconds. */
  readonly durationMs: number;
}
