import type Part from '@domain/part/part';
import type { PartIdentifier } from '@domain/part/partIdentifier';
import type Dimensions from '@domain/part/dimensions';
import type { Fitment } from '@domain/fitment/fitment';
import { PartCategory } from '@domain/part/partCategory';
import { InterchangeSystem } from '@domain/interchange/interchange';

/**
 * Repository interface for Part domain operations.
 * Supports idempotent writes and does not leak database implementation details.
 */
export interface PartRepository {
    /**
     * Find a part by its unique identifier.
     * @param id - Part UUID
     * @returns Part if found, null otherwise
     */
    findById(id: string): Promise<Part | null>;

    /**
     * Find parts by OEM part number.
     * Multiple parts may match if different manufacturers use the same part number.
     * @param partNumber - OEM part number
     * @param manufacturer - Optional manufacturer filter
     * @returns Array of matching parts (empty if none found)
     */
    findByOemPartNumber(partNumber: string, manufacturer?: string): Promise<Part[]>;

    /**
     * Find parts by aftermarket part number.
     * Multiple parts may match if different manufacturers use the same part number.
     * @param partNumber - Aftermarket part number
     * @param manufacturer - Optional manufacturer filter
     * @returns Array of matching parts (empty if none found)
     */
    findByAftermarketPartNumber(partNumber: string, manufacturer?: string): Promise<Part[]>;

    /**
     * Find parts by interchange code (Hollander, Opticat, etc.).
     * @param system - Interchange system (e.g., HOLLANDER, OPTICAT)
     * @param code - Interchange code
     * @returns Array of matching parts (empty if none found)
     */
    findByInterchangeCode(system: InterchangeSystem, code: string): Promise<Part[]>;

    /**
     * Find parts by fitment (vehicle compatibility).
     * Service layer provides Fitment object (VIN decoding handled upstream).
     * @param fitment - Vehicle fitment details
     * @param category - Optional part category filter (e.g., HEADLIGHT)
     * @returns Array of matching parts (empty if none found)
     */
    findByFitment(fitment: Fitment, category?: PartCategory): Promise<Part[]>;

    /**
     * Upsert a part (create or update).
     * Idempotent operation - if part with same characteristics exists, returns existing.
     * @param part - Part data (id optional for create)
     * @returns Created or updated part with generated id
     */
    upsert(part: Omit<Part, 'createdAt' | 'updatedAt'> & { id?: string }): Promise<Part>;

    /**
     * Add a part identifier to an existing part.
     * Idempotent operation - if identifier already exists, no-op.
     * @param partId - Part UUID
     * @param identifier - Part identifier data (createdAt excluded)
     */
    addIdentifier(partId: string, identifier: Omit<PartIdentifier, 'createdAt'>): Promise<void>;

    /**
     * Set or update part dimensions.
     * Upsert operation - creates or updates dimensions for the part.
     * @param partId - Part UUID
     * @param dimensions - Part dimensions
     */
    setDimensions(partId: string, dimensions: Dimensions): Promise<void>;
}
