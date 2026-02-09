import type Vendor from '@domain/vendor/vendor';

/**
 * Repository interface for Vendor domain operations.
 * Supports idempotent writes and does not leak database implementation details.
 */
export interface VendorRepository {
    /**
     * Find a vendor by its unique identifier.
     * @param id - Vendor UUID
     * @returns Vendor if found, null otherwise
     */
    findById(id: string): Promise<Vendor | null>;

    /**
     * Find all vendors.
     * @returns Array of all vendors
     */
    findAll(): Promise<Vendor[]>;

    /**
     * Upsert a vendor (create or update).
     * Idempotent operation - if vendor with same characteristics exists, returns existing.
     * @param vendor - Vendor data (id optional for create, createdAt, updatedAt excluded)
     * @returns Created or updated vendor with generated id
     */
    upsert(vendor: Omit<Vendor, 'createdAt' | 'updatedAt'> & { id?: string }): Promise<Vendor>;

    /**
     * Update vendor reliability metrics.
     * @param id - Vendor UUID
     * @param metrics - Reliability metrics to update
     */
    updateReliabilityMetrics(
        id: string,
        metrics: {
            reliabilityScore?: number;
            cancellationRate?: number;
            averageProcessingTimeHours?: number;
        }
    ): Promise<void>;
}
