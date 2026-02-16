/**
 * Per-vendor lifecycle configuration.
 *
 * Different vendors have different patterns for listing activity:
 * - Salvage yards (LKQ, Car-Part.com): listings disappear when sold,
 *   typically within 3-5 missed polls
 * - Dealer APIs: listings may be explicitly deactivated or just removed
 * - Estimating platforms (CCC): reference data, rarely deactivated
 *
 * This config controls how aggressively the system marks listings
 * as inactive based on missed polls.
 */

/**
 * Lifecycle configuration for a vendor.
 */
export interface LifecycleConfig {
  /**
   * Number of consecutive missed polls before marking PRESUMED_INACTIVE.
   *
   * Lower values = more aggressive deactivation.
   * - Salvage yards: 3 (parts sell quickly)
   * - Dealers: 5 (inventory updates less frequently)
   * - Estimating platforms: 10 (reference data, slow updates)
   */
  readonly missThreshold: number;

  /**
   * Maximum days since lastSeenAt before flagging as stale.
   *
   * Backup to missThreshold for vendors with irregular polling schedules.
   * A listing not seen for this many days is flagged regardless of miss count.
   */
  readonly staleDaysThreshold: number;

  /**
   * Whether this vendor provides explicit deactivation signals.
   *
   * If true, the system also watches for vendor-side isActive=false
   * or partStatus='out_of_stock' signals.
   * If false, only absence detection is used.
   */
  readonly hasExplicitDeactivation: boolean;

  /**
   * Whether to allow reactivation from PRESUMED_INACTIVE.
   *
   * If true, a listing that reappears after being presumed inactive
   * is transitioned back to ACTIVE.
   * If false, presumed inactive listings require manual review.
   */
  readonly allowReactivation: boolean;
}

/**
 * Default lifecycle configs by vendor type.
 */
export const DEFAULT_LIFECYCLE_CONFIGS: Record<string, LifecycleConfig> = {
  salvage: {
    missThreshold: 3,
    staleDaysThreshold: 14,
    hasExplicitDeactivation: false,
    allowReactivation: true,
  },
  dealer: {
    missThreshold: 5,
    staleDaysThreshold: 30,
    hasExplicitDeactivation: true,
    allowReactivation: true,
  },
  estimating: {
    missThreshold: 10,
    staleDaysThreshold: 90,
    hasExplicitDeactivation: false,
    allowReactivation: true,
  },
};

/**
 * Get lifecycle config for a vendor, with fallback to salvage defaults.
 *
 * @param vendorId - The vendor identifier
 * @param vendorConfigs - Map of vendor-specific configs
 * @param vendorType - Vendor type for default fallback ('salvage', 'dealer', 'estimating')
 * @returns LifecycleConfig for the vendor
 */
export function getLifecycleConfig(
  vendorId: string,
  vendorConfigs: Map<string, LifecycleConfig>,
  vendorType: string = 'salvage'
): LifecycleConfig {
  return vendorConfigs.get(vendorId)
    ?? DEFAULT_LIFECYCLE_CONFIGS[vendorType]
    ?? DEFAULT_LIFECYCLE_CONFIGS['salvage'];
}
