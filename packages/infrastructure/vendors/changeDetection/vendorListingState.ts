/**
 * Vendor listing state tracking for change detection.
 * 
 * This tracks the state of each vendor listing to detect changes
 * and prevent unnecessary database writes.
 */
export interface VendorListingState {
  vendorId: string;
  vendorListingExternalId?: string; // or sourceUrl as fallback
  payloadHash: string; // SHA-256 of canonical payload
  lastSeenAt: Date;
  lastChangedAt: Date;
  listingId?: string; // FK to listings table if listing exists
}

/**
 * Input for creating or updating vendor listing state.
 */
export type VendorListingStateInput = Omit<VendorListingState, 'lastSeenAt' | 'lastChangedAt'>;
