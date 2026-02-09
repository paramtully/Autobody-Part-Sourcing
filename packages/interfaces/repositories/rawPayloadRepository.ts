/**
 * Repository interface for RawPayload domain operations.
 * Write-only repository - raw payloads are never mutated after storage.
 * Supports idempotent writes and does not leak database implementation details.
 */
export interface RawPayloadRepository {
    /**
     * Store a raw payload.
     * Idempotent operation - if payload with same hash exists for vendor, returns existing.
     * Raw payloads are never mutated after storage (system invariant).
     * @param payload - Payload data
     * @param payload.vendorId - Vendor UUID
     * @param payload.payload - Raw payload data (JSON-serializable)
     * @param payload.payloadHash - Hash of the payload for deduplication
     * @returns Object with id and isNew flag (true if newly created, false if existing)
     */
    store(payload: {
        vendorId: string;
        payload: unknown;
        payloadHash: string;
    }): Promise<{ id: string; isNew: boolean }>;
}
