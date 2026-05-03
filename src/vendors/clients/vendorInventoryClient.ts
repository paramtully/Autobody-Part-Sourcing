import { VendorRecord, UnknownRawVendorRecord } from "./vendorRecord";


export interface VendorInventoryClient {
    readonly vendorId: string;

    /**
   * Get the current authentication status for this vendor's API.
   * Used by the orchestrator to detect credential expiry (e.g., CCC OAuth tokens)
   * and decide whether to proceed with ingestion.
   * 
   * Optional: vendors without expiring credentials can omit this.
   * 
   * @returns Auth status with validity and expiration time
   */
    getAuthStatus?(): Promise<{ valid: boolean; expiresAt?: Date }>;

    /**
   * Fetch a single page of inventory (for vendors that don't support streaming).
   * Returns paginated response with cursor for next page.
   * 
   * @param cursor - Optional cursor/offset for pagination
   * @returns Paginated response with records and pagination metadata
   */
    fetchInventoryPage?(cursor?: string): Promise<{
        records: UnknownRawVendorRecord[];
        nextCursor?: string;
        hasMore: boolean;
    }>;

    /**
   * Optional: Fetch inventory for specific part numbers (if vendor supports lookup).
   * Not all vendors support this - capability metadata indicates availability.
   * 
   * @param partNumbers - Array of part numbers to lookup
   * @returns Array of raw vendor records matching the part numbers
   */
    fetchByPartNumbers?(partNumbers: string[]): Promise<UnknownRawVendorRecord[]>;

    /**
     * Map a raw vendor record to a vendor record.
     * @param raw - The raw vendor record to map 
     * @returns The vendor record formatted to match the domain model.
     */
    mapRecord(raw: UnknownRawVendorRecord): VendorRecord;
}


