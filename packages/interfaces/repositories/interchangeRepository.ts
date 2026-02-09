import type { Interchange } from '@domain/interchange/interchange';
import { InterchangeSystem } from '@domain/interchange/interchange';
import type Part from '@domain/part/part';

/**
 * Repository interface for Interchange domain operations.
 * Supports idempotent writes and does not leak database implementation details.
 */
export interface InterchangeRepository {
    /**
     * Find an interchange by its unique identifier.
     * @param id - Interchange UUID
     * @returns Interchange if found, null otherwise
     */
    findById(id: string): Promise<Interchange | null>;

    /**
     * Find an interchange by system and code.
     * @param system - Interchange system (e.g., HOLLANDER, OPTICAT)
     * @param code - Interchange code
     * @returns Interchange if found, null otherwise
     */
    findByCode(system: InterchangeSystem, code: string): Promise<Interchange | null>;

    /**
     * Find all parts that are interchangeable with a given part.
     * @param partId - Part UUID
     * @returns Array of interchangeable parts (empty if none found)
     */
    findInterchangeableParts(partId: string): Promise<Part[]>;

    /**
     * Find all interchanges for a part (useful for showing compatibility).
     * @param partId - Part UUID
     * @returns Array of interchanges for the part (empty if none found)
     */
    findByPart(partId: string): Promise<Interchange[]>;

    /**
     * Find parts by any interchange in a group (for search expansion).
     * @param interchangeId - Interchange UUID
     * @returns Array of parts in the interchange group (empty if none found)
     */
    findPartsByInterchangeGroup(interchangeId: string): Promise<Part[]>;


    /**
     * Upsert an interchange (create or update).
     * Idempotent operation - unique constraint on (system, code).
     * @param interchange - Interchange data (id optional for create, createdAt excluded)
     * @returns Created or updated interchange with generated id
     */
    upsert(interchange: Omit<Interchange, 'createdAt'> & { id?: string }): Promise<Interchange>;
}
