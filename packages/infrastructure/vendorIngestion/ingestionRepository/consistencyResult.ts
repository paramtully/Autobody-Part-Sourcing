/**
 * Consistency result types for the IngestionPersistenceService.
 *
 * Each entity extracted from a CleanedDTO is checked against existing
 * database state before upserting. These types capture the outcome of
 * those checks so the caller (and monitoring/logging) can see exactly
 * what happened for every entity in a single upsertListing call.
 */

/**
 * The outcome of a single entity consistency check.
 *
 * - CONSISTENT: Incoming data matches DB (or entity is new). Safe to proceed.
 * - FIXED: Incoming data was adjusted to match DB (e.g., used DB's part
 *   category instead of the DTO's). Proceed with the fixed values.
 * - REJECTED: Hard conflict that cannot be auto-resolved. The listing
 *   must not be persisted.
 */
export type ConsistencyVerdict = 'CONSISTENT' | 'FIXED' | 'REJECTED';

/**
 * Which domain entity was checked.
 */
export type ConsistencyEntity =
    | 'VENDOR'
    | 'WAREHOUSE_LOCATION'
    | 'PART'
    | 'FITMENT'
    | 'INTERCHANGE'
    | 'INTERCHANGE_MEMBERSHIP'
    | 'LISTING'
    | 'LISTING_IMAGE';

/**
 * Result of a consistency check for a single entity.
 */
export interface ConsistencyCheckResult {
    /** Which entity was checked. */
    readonly entity: ConsistencyEntity;

    /** The outcome of the check. */
    readonly verdict: ConsistencyVerdict;

    /** The field that was inconsistent (if any). */
    readonly field?: string;

    /** The value currently in the database. */
    readonly existingValue?: unknown;

    /** The value from the incoming DTO. */
    readonly incomingValue?: unknown;

    /** Human-readable description of what happened / was fixed / why rejected. */
    readonly resolution?: string;
}

/**
 * Tracks which entities were newly created vs reused from existing DB rows.
 */
export interface EntitiesCreated {
    readonly vendor: boolean;
    readonly warehouseLocation: boolean;
    readonly part: boolean;
    readonly fitment: boolean;
    readonly interchange: boolean;
    readonly interchangeMembership: boolean;
    readonly listing: boolean;
    readonly listingImages: boolean;
}

/**
 * Full result of a single `persistListing` call.
 */
export interface UpsertListingResult {
    /** The listing UUID (from DB). */
    readonly listingId: string;

    /** The resolved part UUID. */
    readonly partId: string;

    /** All consistency checks that were performed. */
    readonly consistencyChecks: ConsistencyCheckResult[];

    /** Which entities were newly created vs already existed. */
    readonly entitiesCreated: EntitiesCreated;
}

/**
 * Typed error thrown when a consistency check yields REJECTED.
 * Carries full details for logging / monitoring.
 */
export class ConsistencyRejectionError extends Error {
    public readonly entity: ConsistencyEntity;
    public readonly field?: string;
    public readonly existingValue?: unknown;
    public readonly incomingValue?: unknown;
    public readonly checks: ConsistencyCheckResult[];

    constructor(
        failedCheck: ConsistencyCheckResult,
        allChecks: ConsistencyCheckResult[],
    ) {
        super(
            `Consistency rejection on ${failedCheck.entity}` +
            (failedCheck.field ? `.${failedCheck.field}` : '') +
            `: ${failedCheck.resolution ?? 'no resolution provided'}`,
        );
        this.name = 'ConsistencyRejectionError';
        this.entity = failedCheck.entity;
        this.field = failedCheck.field;
        this.existingValue = failedCheck.existingValue;
        this.incomingValue = failedCheck.incomingValue;
        this.checks = allChecks;
    }
}
