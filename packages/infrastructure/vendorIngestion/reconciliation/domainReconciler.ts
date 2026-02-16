/**
 * DomainReconciler (System 5B)
 *
 * Stateful comparison of incoming CleanedDTOs against existing database state.
 * Determines what action to take for each record: INSERT, UPDATE, SKIP, or CONFLICT.
 *
 * Design principles:
 * - Depends on repository interfaces, not database implementations
 * - Produces ReconciliationResult, does NOT perform writes
 * - The orchestrator decides what to do with the result
 * - ConflictResolver is injected for configurable conflict handling
 * - Separable: if removed, the orchestrator can skip reconciliation and always INSERT/UPDATE
 *
 * Reconciliation logic:
 * 1. Look up existing listing by (vendorId, vendorListingExternalId)
 * 2. If not found -> INSERT
 * 3. If found, compare payloadHash:
 *    a. Same hash -> SKIP (no change)
 *    b. Different hash -> compute changeset, check for conflicts
 *       - No conflicts -> UPDATE with changeset
 *       - Conflicts found -> resolve via ConflictResolver
 */

import type { CleanedDTO } from '../cleaning/cleanedDTO';
import type {
  ReconciliationResult,
  ReconciliationBatchSummary,
  FieldChange,
  ConflictDetail,
} from './reconciliationResult';
import type { ConflictResolver, ConflictResolutionResult } from './conflictResolver';

/**
 * Read-only repository interface for reconciliation.
 *
 * The reconciler only reads from the database to compare state.
 * It never writes -- that's the orchestrator's responsibility.
 */
export interface ReconciliationRepository {
  /**
   * Find an existing listing by vendor ID and external listing ID.
   *
   * @returns The existing listing state, or null if not found
   */
  findByVendorListing(vendorId: string, vendorListingExternalId: string): Promise<ExistingListingState | null>;

  /**
   * Find an existing listing by payload hash.
   * Used for deduplication across different external IDs.
   *
   * @returns The existing listing state, or null if not found
   */
  findByPayloadHash(vendorId: string, payloadHash: string): Promise<ExistingListingState | null>;
}

/**
 * Snapshot of an existing listing's state for comparison.
 */
export interface ExistingListingState {
  /** Database listing ID. */
  readonly listingId: string;

  /** Current payload hash in the database. */
  readonly payloadHash: string;

  /** Current price in minor units. */
  readonly priceMinorMin: number;

  /** Current condition. */
  readonly condition: string;

  /** Current availability status. */
  readonly availabilityStatus: string;

  /** Current quantity available. */
  readonly quantityAvailable?: number;

  /** Current interchange code (if any). */
  readonly interchangeCode?: string;

  /** Current interchange system (if any). */
  readonly interchangeSystem?: string;

  /** Current fitment year range. */
  readonly yearFrom?: number;
  readonly yearTo?: number;

  /** Source vendor of this listing. */
  readonly vendorId: string;

  /** When this listing was last updated in our database. */
  readonly lastUpdatedAt: string;
}

/**
 * DomainReconciler interface.
 *
 * The orchestrator calls reconcile() for each CleanedDTO.
 */
export interface DomainReconciler {
  /**
   * Reconcile a single CleanedDTO against existing database state.
   *
   * @param dto - The cleaned DTO to reconcile
   * @returns ReconciliationResult with action and details
   */
  reconcile(dto: CleanedDTO): Promise<ReconciliationResult>;

  /**
   * Reconcile a batch of CleanedDTOs and return a summary.
   *
   * @param dtos - Array of cleaned DTOs to reconcile
   * @returns Batch summary with aggregate stats
   */
  reconcileBatch(dtos: CleanedDTO[]): Promise<ReconciliationBatchSummary>;
}

/**
 * Threshold for price anomaly detection (percentage change).
 */
const DEFAULT_PRICE_ANOMALY_THRESHOLD = 0.5; // 50%

/**
 * Default DomainReconciler implementation.
 *
 * Uses ReconciliationRepository for database lookups and
 * ConflictResolver for conflict resolution decisions.
 */
export class DefaultDomainReconciler implements DomainReconciler {
  constructor(
    private readonly repository: ReconciliationRepository,
    private readonly conflictResolver: ConflictResolver,
    private readonly priceAnomalyThreshold: number = DEFAULT_PRICE_ANOMALY_THRESHOLD
  ) {}

  async reconcile(dto: CleanedDTO): Promise<ReconciliationResult> {
    const base = {
      vendorId: dto.vendorId,
      vendorListingExternalId: dto.vendorListingExternalId,
      payloadHash: dto.payloadHash,
    };

    // 1. Look up existing listing
    if (!dto.vendorListingExternalId) {
      // No external ID -- can't look up, must insert
      return { ...base, action: 'INSERT', changeset: [], conflicts: [] };
    }

    const existing = await this.repository.findByVendorListing(
      dto.vendorId,
      dto.vendorListingExternalId
    );

    // 2. If not found -> INSERT
    if (!existing) {
      return { ...base, action: 'INSERT', changeset: [], conflicts: [] };
    }

    // 3. Compare payload hash
    if (existing.payloadHash === dto.payloadHash) {
      // Same hash -> SKIP (no change)
      return {
        ...base,
        action: 'SKIP',
        existingListingId: existing.listingId,
        changeset: [],
        conflicts: [],
      };
    }

    // 4. Different hash -> compute changeset and check conflicts
    const changeset = this.computeChangeset(existing, dto);
    const conflicts = this.detectConflicts(existing, dto);

    // 5. Resolve conflicts if any
    if (conflicts.length > 0) {
      const resolutions = conflicts.map((c) =>
        this.conflictResolver.resolve(c, dto.vendorId)
      );

      // If any conflict is REJECT, the whole record is rejected
      if (resolutions.some((r) => r.resolution === 'REJECT')) {
        return {
          ...base,
          action: 'CONFLICT',
          existingListingId: existing.listingId,
          changeset,
          conflicts,
        };
      }

      // If all conflicts are resolved (ACCEPT_INCOMING or FLAG_FOR_REVIEW), proceed as UPDATE
      return {
        ...base,
        action: this.allAccepted(resolutions) ? 'UPDATE' : 'CONFLICT',
        existingListingId: existing.listingId,
        changeset,
        conflicts,
      };
    }

    // 6. No conflicts -> UPDATE
    return {
      ...base,
      action: 'UPDATE',
      existingListingId: existing.listingId,
      changeset,
      conflicts: [],
    };
  }

  async reconcileBatch(dtos: CleanedDTO[]): Promise<ReconciliationBatchSummary> {
    const results: ReconciliationResult[] = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let conflicted = 0;

    for (const dto of dtos) {
      const result = await this.reconcile(dto);
      results.push(result);

      switch (result.action) {
        case 'INSERT': inserted++; break;
        case 'UPDATE': updated++; break;
        case 'SKIP': skipped++; break;
        case 'CONFLICT': conflicted++; break;
      }
    }

    return {
      totalProcessed: dtos.length,
      inserted,
      updated,
      skipped,
      conflicted,
      results,
    };
  }

  /**
   * Compute what fields changed between existing and incoming.
   */
  private computeChangeset(existing: ExistingListingState, dto: CleanedDTO): FieldChange[] {
    const changes: FieldChange[] = [];

    if (existing.priceMinorMin !== dto.priceMinorMin) {
      changes.push({
        field: 'priceMinorMin',
        previousValue: existing.priceMinorMin,
        incomingValue: dto.priceMinorMin,
      });
    }

    if (existing.condition !== dto.condition) {
      changes.push({
        field: 'condition',
        previousValue: existing.condition,
        incomingValue: dto.condition,
      });
    }

    if (existing.availabilityStatus !== dto.availabilityStatus) {
      changes.push({
        field: 'availabilityStatus',
        previousValue: existing.availabilityStatus,
        incomingValue: dto.availabilityStatus,
      });
    }

    if (existing.quantityAvailable !== dto.quantityAvailable) {
      changes.push({
        field: 'quantityAvailable',
        previousValue: existing.quantityAvailable,
        incomingValue: dto.quantityAvailable,
      });
    }

    return changes;
  }

  /**
   * Detect conflicts between existing and incoming data.
   */
  private detectConflicts(existing: ExistingListingState, dto: CleanedDTO): ConflictDetail[] {
    const conflicts: ConflictDetail[] = [];

    // Interchange mismatch
    if (
      dto.interchange?.code &&
      existing.interchangeCode &&
      dto.interchange.code !== existing.interchangeCode
    ) {
      conflicts.push({
        type: 'INTERCHANGE_MISMATCH',
        field: 'interchange.code',
        existingValue: existing.interchangeCode,
        incomingValue: dto.interchange.code,
        existingSourceVendorId: existing.vendorId,
        description: `Interchange code changed from "${existing.interchangeCode}" to "${dto.interchange.code}"`,
      });
    }

    // Price anomaly
    if (existing.priceMinorMin > 0 && dto.priceMinorMin > 0) {
      const pctChange = Math.abs(dto.priceMinorMin - existing.priceMinorMin) / existing.priceMinorMin;
      if (pctChange > this.priceAnomalyThreshold) {
        conflicts.push({
          type: 'PRICE_ANOMALY',
          field: 'priceMinorMin',
          existingValue: existing.priceMinorMin,
          incomingValue: dto.priceMinorMin,
          description: `Price changed by ${(pctChange * 100).toFixed(1)}% (threshold: ${(this.priceAnomalyThreshold * 100).toFixed(0)}%)`,
        });
      }
    }

    // Condition downgrade (suspicious)
    const conditionRank: Record<string, number> = {
      'NEW_OEM': 5,
      'NEW_AFTERMARKET': 4,
      'REMANUFACTURED': 3,
      'RECONDITIONED': 2,
      'RECYCLED': 1,
      'UNKNOWN': 0,
    };
    const existingRank = conditionRank[existing.condition] ?? 0;
    const incomingRank = conditionRank[dto.condition] ?? 0;
    if (existingRank > 0 && incomingRank > 0 && incomingRank < existingRank) {
      conflicts.push({
        type: 'CONDITION_DOWNGRADE',
        field: 'condition',
        existingValue: existing.condition,
        incomingValue: dto.condition,
        description: `Condition downgraded from "${existing.condition}" to "${dto.condition}"`,
      });
    }

    return conflicts;
  }

  /**
   * Check if all conflict resolutions allow proceeding.
   */
  private allAccepted(resolutions: ConflictResolutionResult[]): boolean {
    return resolutions.every(
      (r) => r.resolution === 'ACCEPT_INCOMING' || r.resolution === 'FLAG_FOR_REVIEW'
    );
  }
}
