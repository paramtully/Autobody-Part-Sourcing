import type WarehouseLocation from '@domain/warehouseLocation/warehouseLocation';

/**
 * Repository interface for WarehouseLocation domain operations.
 * Supports idempotent writes and does not leak database implementation details.
 */
export interface WarehouseLocationRepository {
    /**
     * Find a warehouse location by its unique identifier.
     * @param id - WarehouseLocation UUID
     * @returns WarehouseLocation if found, null otherwise
     */
    findById(id: string): Promise<WarehouseLocation | null>;

    /**
     * Find a warehouse location by matching location details.
     * Matches on country, stateOrProvince, city, and postalCode.
     * @param location - WarehouseLocation to match
     * @returns WarehouseLocation if found, null otherwise
     */
    findByLocation(location: WarehouseLocation): Promise<WarehouseLocation | null>;

    /**
     * Upsert a warehouse location (create or update).
     * Idempotent operation - matches on location details.
     * @param location - WarehouseLocation data (id optional for create)
     * @returns Created or updated warehouse location with generated id
     */
    upsert(location: WarehouseLocation & { id?: string }): Promise<WarehouseLocation>;

    /**
     * Link a vendor to a warehouse location.
     * Idempotent operation - creates junction table entry if it doesn't exist.
     * @param vendorId - Vendor UUID
     * @param locationId - WarehouseLocation UUID
     */
    linkVendorToLocation(vendorId: string, locationId: string): Promise<void>;
}
