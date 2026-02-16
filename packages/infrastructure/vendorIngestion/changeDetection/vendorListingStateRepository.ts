import type { VendorListingState, VendorListingStateInput } from './vendorListingState';

/**
 * Repository interface for vendor listing state tracking.
 * 
 * This repository is used for change detection to prevent unnecessary
 * database writes when vendor data hasn't changed.
 */
export interface VendorListingStateRepository {
  /**
   * Find existing state by vendor ID and payload hash.
   * 
   * @param vendorId - Vendor UUID
   * @param payloadHash - SHA-256 hash of canonical payload
   * @returns Existing state if found, null otherwise
   */
  findByHash(vendorId: string, payloadHash: string): Promise<VendorListingState | null>;

  /**
   * Find existing state by vendor ID and listing external ID.
   * 
   * @param vendorId - Vendor UUID
   * @param vendorListingExternalId - Vendor's listing ID
   * @returns Existing state if found, null otherwise
   */
  findByListingId(
    vendorId: string,
    vendorListingExternalId: string
  ): Promise<VendorListingState | null>;

  /**
   * Upsert vendor listing state.
   * Creates new state or updates existing state.
   * 
   * @param state - State data (lastSeenAt and lastChangedAt are auto-managed)
   * @returns Created or updated state
   */
  upsertState(state: VendorListingStateInput): Promise<VendorListingState>;

  /**
   * Mark listing as seen (update lastSeenAt without changing hash).
   * Used when payload hash matches existing state (no changes detected).
   * 
   * @param vendorId - Vendor UUID
   * @param vendorListingExternalId - Vendor's listing ID
   * @param seenAt - Timestamp when listing was seen
   */
  markSeen(vendorId: string, vendorListingExternalId: string, seenAt: Date): Promise<void>;

  /**
   * Find stale listings (listings not seen recently).
   * Used to detect listings that have disappeared from vendor.
   * 
   * @param vendorId - Vendor UUID
   * @param olderThan - Find listings not seen since this date
   * @returns Array of stale listing states
   */
  findStaleListings(vendorId: string, olderThan: Date): Promise<VendorListingState[]>;
}
