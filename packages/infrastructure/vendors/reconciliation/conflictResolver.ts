/**
 * ConflictResolver (System 5B sub-component).
 *
 * Determines how to handle data conflicts between incoming vendor
 * data and existing database state.
 *
 * Resolution strategies are configurable per-vendor:
 * - LKQ interchange data is high-confidence -> accept incoming
 * - CCC One pricing is estimate-only -> keep existing
 * - Salvage yard fitment is low-confidence -> flag for review
 *
 * The ConflictResolver is a pure function -- no database access.
 * It receives the conflict details and returns a resolution decision.
 */

import type { ConflictDetail, ConflictType } from './reconciliationResult';

/**
 * Resolution decision for a conflict.
 */
export type ConflictResolution =
  | 'ACCEPT_INCOMING'   // Use the new vendor data
  | 'KEEP_EXISTING'     // Keep the current database value
  | 'FLAG_FOR_REVIEW'   // Accept incoming but flag for manual review
  | 'REJECT';           // Reject the incoming record entirely

/**
 * Resolution result with reasoning.
 */
export interface ConflictResolutionResult {
  readonly resolution: ConflictResolution;
  readonly reason: string;
  readonly conflict: ConflictDetail;
}

/**
 * ConflictResolver interface.
 *
 * The DomainReconciler calls this when it detects a conflict.
 */
export interface ConflictResolver {
  /**
   * Resolve a single conflict.
   *
   * @param conflict - The conflict detail
   * @param vendorId - The vendor that produced the conflicting data
   * @returns Resolution decision with reasoning
   */
  resolve(conflict: ConflictDetail, vendorId: string): ConflictResolutionResult;
}

/**
 * Per-vendor conflict resolution configuration.
 */
export interface VendorConflictConfig {
  /** Default resolution for conflicts not covered by specific rules. */
  readonly defaultResolution: ConflictResolution;

  /** Override resolution for specific conflict types. */
  readonly overrides?: Partial<Record<ConflictType, ConflictResolution>>;

  /** Maximum price change percentage before flagging as anomaly. */
  readonly priceAnomalyThresholdPercent?: number;
}

/**
 * Default conflict resolver with configurable per-vendor strategies.
 */
export class ConfigurableConflictResolver implements ConflictResolver {
  private readonly vendorConfigs = new Map<string, VendorConflictConfig>();
  private readonly globalDefault: VendorConflictConfig;

  constructor(globalDefault?: Partial<VendorConflictConfig>) {
    this.globalDefault = {
      defaultResolution: 'FLAG_FOR_REVIEW',
      priceAnomalyThresholdPercent: 50,
      ...globalDefault,
    };
  }

  /**
   * Set conflict resolution config for a specific vendor.
   */
  setVendorConfig(vendorId: string, config: VendorConflictConfig): void {
    this.vendorConfigs.set(vendorId, config);
  }

  resolve(conflict: ConflictDetail, vendorId: string): ConflictResolutionResult {
    const config = this.vendorConfigs.get(vendorId) ?? this.globalDefault;

    // Check for specific override for this conflict type
    const override = config.overrides?.[conflict.type];
    if (override) {
      return {
        resolution: override,
        reason: `Vendor "${vendorId}" has explicit resolution "${override}" for ${conflict.type}`,
        conflict,
      };
    }

    // Apply type-specific default logic
    switch (conflict.type) {
      case 'INTERCHANGE_MISMATCH':
        return {
          resolution: config.defaultResolution,
          reason: `Interchange conflict: existing="${String(conflict.existingValue)}", incoming="${String(conflict.incomingValue)}"`,
          conflict,
        };

      case 'PRICE_ANOMALY': {
        const threshold = config.priceAnomalyThresholdPercent ?? 50;
        return {
          resolution: 'FLAG_FOR_REVIEW',
          reason: `Price changed by more than ${threshold}%: ${String(conflict.existingValue)} -> ${String(conflict.incomingValue)}`,
          conflict,
        };
      }

      case 'CONDITION_DOWNGRADE':
        return {
          resolution: 'FLAG_FOR_REVIEW',
          reason: `Condition downgrade detected: ${String(conflict.existingValue)} -> ${String(conflict.incomingValue)}`,
          conflict,
        };

      case 'IDENTITY_COLLISION':
        return {
          resolution: 'REJECT',
          reason: `Identity collision: two different parts mapped to same canonical ID`,
          conflict,
        };

      case 'DUPLICATE_LISTING':
        return {
          resolution: 'KEEP_EXISTING',
          reason: `Duplicate listing from same vendor`,
          conflict,
        };

      default:
        return {
          resolution: config.defaultResolution,
          reason: `Default resolution for ${conflict.type}`,
          conflict,
        };
    }
  }
}
