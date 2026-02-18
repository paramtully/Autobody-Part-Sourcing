/**
 * IngestionRepositories — the facade that the orchestrator calls.
 *
 * The interface stays minimal: the orchestrator only cares about
 * `ingestionRuns` (checkpoint/resume) and `upsertListing` (persist a DTO).
 *
 * DefaultIngestionRepositories wires all individual domain repositories
 * into an IngestionPersistenceService that handles entity resolution,
 * consistency checking, and ordered upserts.
 */

import type { CleanedDTO } from '../cleaning/cleanedDTO';
import type { IngestionRunRepository } from '../ingestion/ingestionRun';
import type { VendorRepository } from '@interfaces/repositories/vendorRepository';
import type { PartRepository } from '@interfaces/repositories/partRepository';
import type { FitmentRepository } from '@interfaces/repositories/fitmentRepository';
import type { InterchangeRepository } from '@interfaces/repositories/interchangeRepository';
import type { InterchangeMembershipRepository } from '@interfaces/repositories/interchangeMembershipRepository';
import type { ListingRepository } from '@interfaces/repositories/listingRepository';
import type { ListingImageRepository } from '@interfaces/repositories/listingImageRepository';
import type { WarehouseLocationRepository } from '@interfaces/repositories/warehouseLocationRepository';
import type { ConsistencyChecker } from './consistencyChecker';
import { DefaultConsistencyChecker } from './consistencyChecker';
import { IngestionPersistenceService } from './ingestionPersistenceService';
import type { UpsertListingResult } from './consistencyResult';

// ─── Interface ───────────────────────────────────────────────────────

/**
 * Repository interfaces needed by the orchestrator.
 * Kept minimal -- only what the orchestrator actually calls.
 */
export interface IngestionRepositories {
    /** For ingestion run checkpoint/resume. */
    ingestionRuns: IngestionRunRepository;

    /**
     * Upsert a listing from a reconciled DTO.
     * Internally resolves all constituent entities (vendor, part, fitment,
     * interchange, warehouse location, listing, images), checks consistency,
     * and persists in FK-dependency order.
     *
     * @throws ConsistencyRejectionError if a hard conflict is detected.
     */
    upsertListing(
        dto: CleanedDTO,
        action: 'INSERT' | 'UPDATE',
    ): Promise<UpsertListingResult>;
}

// ─── Dependencies ────────────────────────────────────────────────────

export interface DefaultIngestionRepositoriesDeps {
    ingestionRuns: IngestionRunRepository;
    vendorRepo: VendorRepository;
    partRepo: PartRepository;
    fitmentRepo: FitmentRepository;
    interchangeRepo: InterchangeRepository;
    interchangeMembershipRepo: InterchangeMembershipRepository;
    listingRepo: ListingRepository;
    listingImageRepo: ListingImageRepository;
    warehouseLocationRepo: WarehouseLocationRepository;
    consistencyChecker?: ConsistencyChecker;
}

// ─── Implementation ──────────────────────────────────────────────────

export class DefaultIngestionRepositories implements IngestionRepositories {
    public readonly ingestionRuns: IngestionRunRepository;
    private readonly persistenceService: IngestionPersistenceService;

    constructor(deps: DefaultIngestionRepositoriesDeps) {
        this.ingestionRuns = deps.ingestionRuns;

        this.persistenceService = new IngestionPersistenceService({
            vendorRepo: deps.vendorRepo,
            partRepo: deps.partRepo,
            fitmentRepo: deps.fitmentRepo,
            interchangeRepo: deps.interchangeRepo,
            interchangeMembershipRepo: deps.interchangeMembershipRepo,
            listingRepo: deps.listingRepo,
            listingImageRepo: deps.listingImageRepo,
            warehouseLocationRepo: deps.warehouseLocationRepo,
            consistencyChecker:
                deps.consistencyChecker ?? new DefaultConsistencyChecker(),
        });
    }

    async upsertListing(
        dto: CleanedDTO,
        action: 'INSERT' | 'UPDATE',
    ): Promise<UpsertListingResult> {
        return this.persistenceService.persistListing(dto, action);
    }
}
