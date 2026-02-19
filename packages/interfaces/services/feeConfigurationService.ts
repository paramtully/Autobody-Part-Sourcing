/**
 * Single source of truth for the platform service fee percentage.
 * Backed by the `fee_configurations` table.
 */
export interface FeeConfigurationService {
    /**
     * Returns the currently active fee percentage (e.g. 0.03 for 3%).
     * Reads the row where `effective_until IS NULL`.
     */
    getCurrentFeePercent(): Promise<number>;
}
