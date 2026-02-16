/**
 * ListingLifecycleManager (System 6)
 *
 * Manages the lifecycle of vendor listings: tracking when listings
 * are seen, detecting stale listings, and applying deactivation.
 *
 * Design principles:
 * - Independent system: can run as a scheduled job or inline with ingestion
 * - Depends on repository interfaces, not database implementations
 * - Uses the state machine for pure state transitions
 * - Separable: if removed, listings are never marked inactive (fail-open)
 *
 * Three main operations:
 * 1. recordSeen(vendorId, listingExternalId, seenAt) -- called during ingestion
 * 2. detectStaleListings(vendorId, config) -- run post-ingestion or on schedule
 * 3. applyVendorDeactivation(vendorId, listingExternalId, reason) -- explicit vendor signal
 */

import type { LifecycleConfig } from './lifecycleConfig';
import { getLifecycleConfig } from './lifecycleConfig';
import type { ListingLifecycleState, StateTransitionResult } from './listingStateMachine';
import { transitionListingState } from './listingStateMachine';

/**
 * Repository interface for lifecycle state persistence.
 *
 * Separate from ReconciliationRepository because lifecycle
 * has different access patterns (batch staleness queries).
 */
export interface LifecycleRepository {
  /**
   * Get the lifecycle state for a specific listing.
   */
  getLifecycleState(vendorId: string, vendorListingExternalId: string): Promise<ListingLifecycleRecord | null>;

  /**
   * Update the lifecycle state for a listing.
   */
  upsertLifecycleState(record: ListingLifecycleRecord): Promise<void>;

  /**
   * Find all active listings for a vendor that haven't been seen
   * since the given date (for stale detection).
   */
  findStaleActiveListings(vendorId: string, notSeenSince: Date): Promise<ListingLifecycleRecord[]>;

  /**
   * Find all active listings for a vendor that have been missed
   * at least N consecutive times.
   */
  findMissedListings(vendorId: string, minMissCount: number): Promise<ListingLifecycleRecord[]>;

  /**
   * Batch update lifecycle states (for stale detection results).
   */
  batchUpdateLifecycleStates(records: ListingLifecycleRecord[]): Promise<void>;
}

/**
 * Lifecycle state record for a listing.
 */
export interface ListingLifecycleRecord {
  readonly vendorId: string;
  readonly vendorListingExternalId: string;
  readonly state: ListingLifecycleState;
  readonly consecutiveMissCount: number;
  readonly lastSeenAt: string;
  readonly markedInactiveAt?: string;
  readonly reactivatedAt?: string;
  readonly inactiveReason?: string;
}

/**
 * Result of a stale detection run.
 */
export interface StaleDetectionResult {
  readonly vendorId: string;
  readonly totalActive: number;
  readonly totalStale: number;
  readonly deactivated: number;
  readonly deactivatedListings: Array<{
    vendorListingExternalId: string;
    reason: string;
    missCount: number;
  }>;
}

/**
 * ListingLifecycleManager interface.
 */
export interface ListingLifecycleManager {
  /**
   * Record that a listing was seen in the current ingestion run.
   * Called for each listing during ingestion.
   *
   * @param vendorId - Vendor identifier
   * @param vendorListingExternalId - Vendor's listing ID
   * @param seenAt - ISO timestamp of when the listing was seen
   * @returns State transition result
   */
  recordSeen(
    vendorId: string,
    vendorListingExternalId: string,
    seenAt: string
  ): Promise<StateTransitionResult>;

  /**
   * Detect and deactivate stale listings for a vendor.
   * Typically run after a complete ingestion cycle (all pages fetched).
   *
   * @param vendorId - Vendor identifier
   * @returns Detection result with stats
   */
  detectStaleListings(vendorId: string): Promise<StaleDetectionResult>;

  /**
   * Apply explicit vendor deactivation signal.
   * Called when vendor data indicates a listing is no longer active.
   *
   * @param vendorId - Vendor identifier
   * @param vendorListingExternalId - Vendor's listing ID
   * @param reason - Reason for deactivation (e.g., 'SOLD', 'DISCONTINUED')
   * @returns State transition result
   */
  applyVendorDeactivation(
    vendorId: string,
    vendorListingExternalId: string,
    reason: string
  ): Promise<StateTransitionResult>;
}

/**
 * Default ListingLifecycleManager implementation.
 */
export class DefaultListingLifecycleManager implements ListingLifecycleManager {
  private readonly vendorConfigs = new Map<string, LifecycleConfig>();

  constructor(
    private readonly repository: LifecycleRepository,
    vendorConfigs?: Map<string, LifecycleConfig>
  ) {
    if (vendorConfigs) {
      for (const [vendorId, config] of vendorConfigs) {
        this.vendorConfigs.set(vendorId, config);
      }
    }
  }

  async recordSeen(
    vendorId: string,
    vendorListingExternalId: string,
    seenAt: string
  ): Promise<StateTransitionResult> {
    const config = getLifecycleConfig(vendorId, this.vendorConfigs);
    const existing = await this.repository.getLifecycleState(vendorId, vendorListingExternalId);

    const currentState: ListingLifecycleState = existing?.state ?? 'ACTIVE';
    const result = transitionListingState(
      currentState,
      { type: 'SEEN', seenAt },
      config.allowReactivation
    );

    await this.repository.upsertLifecycleState({
      vendorId,
      vendorListingExternalId,
      state: result.newState,
      consecutiveMissCount: 0, // Reset on seen
      lastSeenAt: seenAt,
      markedInactiveAt: result.timestamps.markedInactiveAt ?? existing?.markedInactiveAt,
      reactivatedAt: result.timestamps.reactivatedAt ?? existing?.reactivatedAt,
    });

    return result;
  }

  async detectStaleListings(vendorId: string): Promise<StaleDetectionResult> {
    const config = getLifecycleConfig(vendorId, this.vendorConfigs);

    // Find listings that have been missed enough times
    const missedListings = await this.repository.findMissedListings(
      vendorId,
      config.missThreshold
    );

    // Also find listings not seen for too many days
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - config.staleDaysThreshold);
    const dateStaleListings = await this.repository.findStaleActiveListings(vendorId, staleCutoff);

    // Merge and deduplicate
    const allStale = new Map<string, ListingLifecycleRecord>();
    for (const listing of [...missedListings, ...dateStaleListings]) {
      allStale.set(listing.vendorListingExternalId, listing);
    }

    // Transition each stale listing
    const deactivated: StaleDetectionResult['deactivatedListings'] = [];
    const updatedRecords: ListingLifecycleRecord[] = [];

    for (const listing of allStale.values()) {
      const result = transitionListingState(
        listing.state,
        { type: 'MISSED', missCount: listing.consecutiveMissCount, missThreshold: config.missThreshold },
        config.allowReactivation
      );

      if (result.changed) {
        deactivated.push({
          vendorListingExternalId: listing.vendorListingExternalId,
          reason: result.reason,
          missCount: listing.consecutiveMissCount,
        });

        updatedRecords.push({
          ...listing,
          state: result.newState,
          markedInactiveAt: result.timestamps.markedInactiveAt ?? listing.markedInactiveAt,
          inactiveReason: result.reason,
        });
      }
    }

    // Batch update all deactivated listings
    if (updatedRecords.length > 0) {
      await this.repository.batchUpdateLifecycleStates(updatedRecords);
    }

    return {
      vendorId,
      totalActive: 0, // Would need a count query to populate
      totalStale: allStale.size,
      deactivated: deactivated.length,
      deactivatedListings: deactivated,
    };
  }

  async applyVendorDeactivation(
    vendorId: string,
    vendorListingExternalId: string,
    reason: string
  ): Promise<StateTransitionResult> {
    const config = getLifecycleConfig(vendorId, this.vendorConfigs);
    const existing = await this.repository.getLifecycleState(vendorId, vendorListingExternalId);

    const currentState: ListingLifecycleState = existing?.state ?? 'ACTIVE';
    const result = transitionListingState(
      currentState,
      { type: 'VENDOR_DEACTIVATED', reason },
      config.allowReactivation
    );

    await this.repository.upsertLifecycleState({
      vendorId,
      vendorListingExternalId,
      state: result.newState,
      consecutiveMissCount: existing?.consecutiveMissCount ?? 0,
      lastSeenAt: existing?.lastSeenAt ?? new Date().toISOString(),
      markedInactiveAt: result.timestamps.markedInactiveAt ?? existing?.markedInactiveAt,
      inactiveReason: reason,
    });

    return result;
  }
}
