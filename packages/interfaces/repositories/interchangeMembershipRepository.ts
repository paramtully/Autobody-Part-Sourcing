import type InterchangeMembership from '@domain/interchange/interchangeMembership';

/**
 * Repository interface for InterchangeMembership domain operations.
 * Supports idempotent writes and does not leak database implementation details.
 */
export interface InterchangeMembershipRepository {
    /**
     * Find an interchange membership by its unique identifier.
     * @param id - InterchangeMembership UUID
     * @returns InterchangeMembership if found, null otherwise
     */
    findById(id: string): Promise<InterchangeMembership | null>;

    /**
     * Find all interchange memberships for a specific part.
     * @param partId - Part UUID
     * @returns Array of interchange memberships for the part (empty if none found)
     */
    findByPart(partId: string): Promise<InterchangeMembership[]>;

    /**
     * Find all interchange memberships for a specific interchange.
     * @param interchangeId - Interchange UUID
     * @returns Array of interchange memberships for the interchange (empty if none found)
     */
    findByInterchange(interchangeId: string): Promise<InterchangeMembership[]>;

    /**
     * Upsert an interchange membership (create or update).
     * Idempotent operation - unique constraint on (partId, interchangeId).
     * @param membership - InterchangeMembership data (id optional for create, createdAt excluded)
     * @returns Created or updated interchange membership with generated id
     */
    upsert(membership: Omit<InterchangeMembership, 'createdAt'> & { id?: string }): Promise<InterchangeMembership>;
}
