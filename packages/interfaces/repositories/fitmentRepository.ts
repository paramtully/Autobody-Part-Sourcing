import type { Fitment } from '@domain/fitment/fitment';
import { PartCategory } from '@domain/part/partCategory';

/**
 * Repository interface for Fitment domain operations.
 * Supports idempotent writes and does not leak database implementation details.
 * Fitments are stored in normalized form in the database and aggregated into domain Fitment objects.
 */
export interface FitmentRepository {
  /**
   * Find a fitment by its unique identifier.
   * Aggregates normalized rows into a single Fitment object.
   * @param id - Fitment UUID
   * @returns Fitment if found, null otherwise
   */
  findById(id: string): Promise<Fitment | null>;

  /**
   * Find all fitments for a specific part.
   * Aggregates normalized rows into Fitment objects.
   * @param partId - Part UUID
   * @returns Array of fitments for the part (empty if none found)
   */
  findByPart(partId: string): Promise<Fitment[]>;

  /**
   * Find part IDs that match a given fitment.
   * Service layer provides Fitment object (VIN decoding handled upstream).
   * @param fitment - Vehicle fitment details
   * @param category - Optional part category filter (e.g., HEADLIGHT)
   * @returns Array of matching part IDs (empty if none found)
   */
  findPartsByFitment(fitment: Fitment, category?: PartCategory): Promise<string[]>;

  /**
   * Upsert a fitment (create or update).
   * Idempotent operation - creates normalized rows in the database.
   * Unique constraint on (make, model, year, constraint, trim, engine).
   * @param fitment - Fitment data
   * @returns Created or updated fitment with generated id
   */
  upsert(fitment: Fitment): Promise<Fitment>;

  /**
   * Link a part to a fitment.
   * Idempotent operation - creates junction table entry if it doesn't exist.
   * @param partId - Part UUID
   * @param fitmentId - Fitment UUID
   */
  linkPartToFitment(partId: string, fitmentId: string): Promise<void>;
}
