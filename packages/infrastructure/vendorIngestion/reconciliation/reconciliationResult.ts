/**
 * Reconciliation result types (System 5B).
 *
 * After cleaning, the DomainReconciler compares each CleanedDTO
 * against existing database state and produces a ReconciliationResult.
 *
 * The result tells the orchestrator what to do:
 * - INSERT: new listing, create it
 * - UPDATE: existing listing changed, update specific fields
 * - SKIP: listing unchanged (same payload hash)
 * - CONFLICT: data conflict requiring resolution (e.g., interchange mismatch)
 */

/**
 * What changed between the incoming DTO and existing DB state.
 */
export interface FieldChange {
  /** The field that changed (dot-notation for nested). */
  readonly field: string;

  /** Previous value in the database. */
  readonly previousValue: unknown;

  /** New value from the incoming DTO. */
  readonly incomingValue: unknown;
}

/**
 * Conflict detail when incoming data disagrees with existing data.
 */
export interface ConflictDetail {
  /** Type of conflict. */
  readonly type: ConflictType;

  /** Field or entity involved. */
  readonly field: string;

  /** The existing value in the database. */
  readonly existingValue: unknown;

  /** The incoming value from the vendor. */
  readonly incomingValue: unknown;

  /** Source vendor of the existing value (if from a different vendor). */
  readonly existingSourceVendorId?: string;

  /** Human-readable description of the conflict. */
  readonly description: string;
}

/**
 * Types of data conflicts.
 */
export type ConflictType =
  | 'INTERCHANGE_MISMATCH'   // Vendor A says Hollander X, vendor B says Y
  | 'FITMENT_MISMATCH'       // Year range or trim disagreement
  | 'CONDITION_DOWNGRADE'    // Condition worsened (suspicious)
  | 'PRICE_ANOMALY'          // Price changed by > 50% (potential error)
  | 'IDENTITY_COLLISION'     // Two different parts mapped to same canonical ID
  | 'DUPLICATE_LISTING';     // Same listing appears from same vendor twice

/**
 * Reconciliation action to take.
 */
export type ReconciliationAction = 'INSERT' | 'UPDATE' | 'SKIP' | 'CONFLICT';

/**
 * Full reconciliation result for a single DTO.
 */
export interface ReconciliationResult {
  /** What action the orchestrator should take. */
  readonly action: ReconciliationAction;

  /** Vendor ID of the record. */
  readonly vendorId: string;

  /** External listing ID from the vendor. */
  readonly vendorListingExternalId?: string;

  /**
   * Fields that changed (only for UPDATE action).
   * Empty for INSERT, SKIP, and CONFLICT.
   */
  readonly changeset: FieldChange[];

  /**
   * Conflicts detected (only for CONFLICT action).
   * May also be non-empty for UPDATE with warnings.
   */
  readonly conflicts: ConflictDetail[];

  /**
   * The existing listing ID in the database (if found).
   * Null for INSERT action (new listing).
   */
  readonly existingListingId?: string;

  /**
   * The payload hash used for change detection.
   * If it matches the existing hash, action is SKIP.
   */
  readonly payloadHash: string;
}

/**
 * Batch reconciliation result for monitoring and logging.
 */
export interface ReconciliationBatchSummary {
  readonly totalProcessed: number;
  readonly inserted: number;
  readonly updated: number;
  readonly skipped: number;
  readonly conflicted: number;
  readonly results: ReconciliationResult[];
}
