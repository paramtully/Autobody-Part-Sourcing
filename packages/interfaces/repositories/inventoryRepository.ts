import type { InventoryRecord } from '@domain/inventoryRecord/inventoryRecord';
import type { Vendor } from '@domain/vendor/vendor';
import type { Part } from '@domain/part/part';
import type { PaginationParams, PaginatedResult } from './pagination';

/**
 * Repository interface for InventoryRecord domain operations.
 * Inventory records are computed on-demand from listings, not stored separately.
 * Does not leak database implementation details.
 */
export interface InventoryRepository {
  /**
   * Get aggregated inventory record for a specific vendor and part.
   * Computes statistics from listings table on-demand.
   * @param vendor - Vendor domain object
   * @param part - Part domain object
   * @returns InventoryRecord if listings exist, null otherwise
   */
  getInventoryRecord(vendor: Vendor, part: Part): Promise<InventoryRecord | null>;

  /**
   * Get all inventory records for a specific part across all vendors.
   * Computes statistics from listings table on-demand for each vendor.
   * @param part - Part domain object
   * @param pagination - Optional pagination parameters. If provided, returns PaginatedResult.
   * @returns Array of InventoryRecords (one per vendor with listings for this part), or PaginatedResult if pagination provided
   */
  getInventoryRecordsByPart(
    part: Part,
    pagination?: PaginationParams
  ): Promise<InventoryRecord[] | PaginatedResult<InventoryRecord>>;
}
