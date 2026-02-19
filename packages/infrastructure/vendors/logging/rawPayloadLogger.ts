/**
 * Raw Payload Logger (System 3)
 *
 * Append-only logger for vendor API responses. Stores raw payloads
 * at the batch/page level (one row per API response, not per listing)
 * for audit, replay, and debugging.
 *
 * Design principles:
 * - Completely independent of the pipeline -- if removed, nothing breaks
 * - Injected as an optional dependency into the orchestrator
 * - Immutability: raw payloads are never mutated after storage
 * - Idempotent: duplicate payloads (same hash) are safely skipped
 * - Batch-level: stores full API page responses, not individual listings
 *
 * The logger delegates actual persistence to RawPayloadRepository,
 * keeping this module free of database concerns.
 */

import { createHash } from 'crypto';

/**
 * Result of logging a raw payload.
 */
export interface RawPayloadLogResult {
  /** UUID of the stored raw payload row. */
  readonly id: string;

  /** True if this payload was newly stored; false if a duplicate was detected. */
  readonly isNew: boolean;

  /** The computed hash of the payload. */
  readonly payloadHash: string;
}

/**
 * Input for logging a batch of raw vendor data.
 */
export interface RawPayloadLogEntry {
  /** Vendor identifier. */
  readonly vendorId: string;

  /** Raw response body from the vendor API (the full page/batch). */
  readonly payload: unknown;

  /** Ingestion run ID this payload belongs to. */
  readonly ingestionRunId?: string;

  /** Schema version for replay compatibility. */
  readonly schemaVersion?: string;

  /** Pre-computed payload hash (if available from change detection). */
  readonly payloadHash?: string;

  /** Vendor listing external ID (for per-listing deduplication). */
  readonly vendorListingExternalId?: string;

  /**
   * Retention duration in days. When set, retainUntil = now + retentionDays.
   * If undefined, the store uses a default retention policy (e.g. 30 days).
   * Set to null to retain indefinitely.
   */
  readonly retentionDays?: number | null;
}

/**
 * Raw payload logger interface.
 *
 * Independent system -- can be provided or omitted.
 * The orchestrator calls `log()` if a logger is injected;
 * if not, raw payloads simply aren't stored.
 */
export interface RawPayloadLogger {
  /**
   * Log a single raw payload (typically one API page/batch response).
   *
   * @param entry - The payload to log
   * @returns Log result with ID and deduplication flag
   */
  log(entry: RawPayloadLogEntry): Promise<RawPayloadLogResult>;

  /**
   * Log multiple raw payloads in a batch.
   * Default implementation calls log() in sequence.
   *
   * @param entries - Array of payloads to log
   * @returns Array of log results
   */
  logBatch(entries: RawPayloadLogEntry[]): Promise<RawPayloadLogResult[]>;
}

/**
 * Repository interface required by the default logger implementation.
 * Matches the existing RawPayloadRepository from packages/interfaces.
 */
export interface RawPayloadStore {
  store(payload: {
    vendorId: string;
    payload: unknown;
    payloadHash: string;
    vendorListingExternalId?: string;
    ingestionRunId?: string;
    retainUntil?: Date | null;
  }): Promise<{ id: string; isNew: boolean }>;
}

/** Default retention in days for raw payloads. */
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Default implementation of RawPayloadLogger.
 *
 * Delegates to a RawPayloadStore (repository) for actual persistence.
 * Computes SHA-256 hash of the payload for deduplication if not provided.
 * Applies retention policy: payloads are auto-deleted after retentionDays.
 */
export class DefaultRawPayloadLogger implements RawPayloadLogger {
  private readonly defaultRetentionDays: number;

  constructor(
    private readonly store: RawPayloadStore,
    options?: { defaultRetentionDays?: number }
  ) {
    this.defaultRetentionDays = options?.defaultRetentionDays ?? DEFAULT_RETENTION_DAYS;
  }

  async log(entry: RawPayloadLogEntry): Promise<RawPayloadLogResult> {
    const payloadHash = entry.payloadHash ?? this.computeHash(entry.payload);

    // Compute retainUntil from retention policy
    const retainUntil = this.computeRetainUntil(entry.retentionDays);

    const result = await this.store.store({
      vendorId: entry.vendorId,
      payload: entry.payload,
      payloadHash,
      vendorListingExternalId: entry.vendorListingExternalId,
      ingestionRunId: entry.ingestionRunId,
      retainUntil,
    });

    return {
      id: result.id,
      isNew: result.isNew,
      payloadHash,
    };
  }

  async logBatch(entries: RawPayloadLogEntry[]): Promise<RawPayloadLogResult[]> {
    const results: RawPayloadLogResult[] = [];
    for (const entry of entries) {
      results.push(await this.log(entry));
    }
    return results;
  }

  /**
   * Compute SHA-256 hash of a payload for deduplication.
   * Uses canonical JSON stringification (sorted keys) for determinism.
   */
  private computeHash(payload: unknown): string {
    const canonical = JSON.stringify(payload, Object.keys(
      typeof payload === 'object' && payload !== null ? payload : {}
    ).sort());
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Compute the retainUntil timestamp based on retention policy.
   *
   * @param retentionDays - Days to retain. null = retain indefinitely. undefined = use default.
   * @returns Date when the payload can be deleted, or null for indefinite retention.
   */
  private computeRetainUntil(retentionDays: number | null | undefined): Date | null {
    if (retentionDays === null) {
      return null; // Retain indefinitely
    }
    const days = retentionDays ?? this.defaultRetentionDays;
    const retainUntil = new Date();
    retainUntil.setDate(retainUntil.getDate() + days);
    return retainUntil;
  }
}

/**
 * No-op logger that does nothing.
 *
 * Used when raw payload logging is disabled. Returns fake results
 * so callers don't need to check for null/undefined.
 */
export class NoOpRawPayloadLogger implements RawPayloadLogger {
  async log(entry: RawPayloadLogEntry): Promise<RawPayloadLogResult> {
    return {
      id: 'noop',
      isNew: false,
      payloadHash: entry.payloadHash ?? 'noop',
    };
  }

  async logBatch(entries: RawPayloadLogEntry[]): Promise<RawPayloadLogResult[]> {
    return entries.map((entry) => ({
      id: 'noop',
      isNew: false,
      payloadHash: entry.payloadHash ?? 'noop',
    }));
  }
}
