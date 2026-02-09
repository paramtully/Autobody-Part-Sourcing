import type InterchangeMembership from '@domain/interchange/interchangeMembership';
import type { PaginationParams, PaginatedResult } from './pagination';

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
     * @param pagination - Optional pagination parameters. If provided, returns PaginatedResult.
     * @returns Array of interchange memberships for the part (empty if none found), or PaginatedResult if pagination provided
     */
    findByPart(
        partId: string,
        pagination?: PaginationParams
    ): Promise<InterchangeMembership[] | PaginatedResult<InterchangeMembership>>;

    /**
     * Find all interchange memberships for a specific interchange.
     * @param interchangeId - Interchange UUID
     * @param pagination - Optional pagination parameters. If provided, returns PaginatedResult.
     * @returns Array of interchange memberships for the interchange (empty if none found), or PaginatedResult if pagination provided
     */
    findByInterchange(
        interchangeId: string,
        pagination?: PaginationParams
    ): Promise<InterchangeMembership[] | PaginatedResult<InterchangeMembership>>;

    /**
     * Upsert an interchange membership (create or update).
     * Idempotent operation - unique constraint on (partId, interchangeId).
     * @param membership - InterchangeMembership data (id optional for create, createdAt excluded)
     * @returns Created or updated interchange membership with generated id
     */
    upsert(membership: Omit<InterchangeMembership, 'createdAt'> & { id?: string }): Promise<InterchangeMembership>;
}
