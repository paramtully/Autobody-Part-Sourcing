/**
 * Listing state machine (System 6 sub-component).
 *
 * Manages state transitions for individual listings:
 *
 *   ACTIVE ---(vendor says inactive)---> VENDOR_INACTIVE
 *   ACTIVE ---(missed N consecutive polls)---> PRESUMED_INACTIVE
 *   PRESUMED_INACTIVE ---(seen again)---> ACTIVE
 *   VENDOR_INACTIVE ---(seen again as active)---> ACTIVE
 *
 * The state machine is a pure function -- no database access.
 * It receives the current state and an event, and returns the new state.
 */

/**
 * Listing lifecycle states.
 */
export type ListingLifecycleState =
  | 'ACTIVE'
  | 'PRESUMED_INACTIVE'
  | 'VENDOR_INACTIVE';

/**
 * Events that trigger state transitions.
 */
export type ListingLifecycleEvent =
  | { type: 'SEEN'; seenAt: string }
  | { type: 'MISSED'; missCount: number; missThreshold: number }
  | { type: 'VENDOR_DEACTIVATED'; reason: string }
  | { type: 'VENDOR_REACTIVATED'; seenAt: string };

/**
 * The result of a state transition.
 */
export interface StateTransitionResult {
  /** The new state after the transition. */
  readonly newState: ListingLifecycleState;

  /** Whether the state actually changed. */
  readonly changed: boolean;

  /** Reason for the transition (for logging). */
  readonly reason: string;

  /** Updated timestamp fields. */
  readonly timestamps: {
    lastSeenAt?: string;
    markedInactiveAt?: string;
    reactivatedAt?: string;
  };
}

/**
 * Compute the next state for a listing given a lifecycle event.
 *
 * Pure function -- no side effects.
 *
 * @param currentState - Current lifecycle state of the listing
 * @param event - The lifecycle event that occurred
 * @param allowReactivation - Whether to allow transition from inactive back to active
 * @returns State transition result
 */
export function transitionListingState(
  currentState: ListingLifecycleState,
  event: ListingLifecycleEvent,
  allowReactivation: boolean = true
): StateTransitionResult {
  switch (event.type) {
    case 'SEEN':
      return handleSeen(currentState, event.seenAt, allowReactivation);

    case 'MISSED':
      return handleMissed(currentState, event.missCount, event.missThreshold);

    case 'VENDOR_DEACTIVATED':
      return handleVendorDeactivated(currentState, event.reason);

    case 'VENDOR_REACTIVATED':
      return handleSeen(currentState, event.seenAt, allowReactivation);
  }
}

/**
 * Handle a SEEN event (listing appeared in vendor feed).
 */
function handleSeen(
  currentState: ListingLifecycleState,
  seenAt: string,
  allowReactivation: boolean
): StateTransitionResult {
  switch (currentState) {
    case 'ACTIVE':
      // Already active, just update lastSeenAt
      return {
        newState: 'ACTIVE',
        changed: false,
        reason: 'Listing still active',
        timestamps: { lastSeenAt: seenAt },
      };

    case 'PRESUMED_INACTIVE':
      // Reappeared! Transition back to ACTIVE if allowed
      if (allowReactivation) {
        return {
          newState: 'ACTIVE',
          changed: true,
          reason: 'Listing reappeared after being presumed inactive',
          timestamps: { lastSeenAt: seenAt, reactivatedAt: seenAt },
        };
      }
      return {
        newState: 'PRESUMED_INACTIVE',
        changed: false,
        reason: 'Listing reappeared but reactivation is disabled',
        timestamps: { lastSeenAt: seenAt },
      };

    case 'VENDOR_INACTIVE':
      // Vendor previously deactivated, but now showing as active
      if (allowReactivation) {
        return {
          newState: 'ACTIVE',
          changed: true,
          reason: 'Vendor-deactivated listing reappeared as active',
          timestamps: { lastSeenAt: seenAt, reactivatedAt: seenAt },
        };
      }
      return {
        newState: 'VENDOR_INACTIVE',
        changed: false,
        reason: 'Vendor-deactivated listing reappeared but reactivation is disabled',
        timestamps: { lastSeenAt: seenAt },
      };
  }
}

/**
 * Handle a MISSED event (listing not found in vendor feed).
 */
function handleMissed(
  currentState: ListingLifecycleState,
  missCount: number,
  missThreshold: number
): StateTransitionResult {
  switch (currentState) {
    case 'ACTIVE':
      if (missCount >= missThreshold) {
        return {
          newState: 'PRESUMED_INACTIVE',
          changed: true,
          reason: `Missed ${missCount} consecutive polls (threshold: ${missThreshold})`,
          timestamps: { markedInactiveAt: new Date().toISOString() },
        };
      }
      return {
        newState: 'ACTIVE',
        changed: false,
        reason: `Missed ${missCount}/${missThreshold} polls`,
        timestamps: {},
      };

    case 'PRESUMED_INACTIVE':
    case 'VENDOR_INACTIVE':
      // Already inactive, no state change
      return {
        newState: currentState,
        changed: false,
        reason: `Already ${currentState}, missed poll ignored`,
        timestamps: {},
      };
  }
}

/**
 * Handle a VENDOR_DEACTIVATED event (vendor explicitly marked inactive).
 */
function handleVendorDeactivated(
  currentState: ListingLifecycleState,
  reason: string
): StateTransitionResult {
  if (currentState === 'VENDOR_INACTIVE') {
    return {
      newState: 'VENDOR_INACTIVE',
      changed: false,
      reason: `Already vendor-inactive: ${reason}`,
      timestamps: {},
    };
  }

  return {
    newState: 'VENDOR_INACTIVE',
    changed: true,
    reason: `Vendor deactivated: ${reason}`,
    timestamps: { markedInactiveAt: new Date().toISOString() },
  };
}
