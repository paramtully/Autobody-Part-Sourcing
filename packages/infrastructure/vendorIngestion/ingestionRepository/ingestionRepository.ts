import { CleanedDTO } from "../cleaning/cleanedDTO";
import { IngestionRunRepository } from "../ingestion/ingestionRun";

/**
 * Repository interfaces needed by the orchestrator.
 * Kept minimal -- only what the orchestrator actually calls.
 */
export interface IngestionRepositories {
    /** For ingestion run checkpoint/resume. */
    ingestionRuns: IngestionRunRepository;
  
    /**
     * Upsert a listing from a reconciled DTO.
     * The orchestrator is agnostic to the listing schema --
     * it passes the CleanedDTO and lets the repository handle mapping.
     */
    upsertListing(dto: CleanedDTO, action: 'INSERT' | 'UPDATE'): Promise<{ listingId: string }>;
}

export class DefaultIngestionRepositories implements IngestionRepositories {

    constructor(private readonly ingestionRuns: IngestionRunRepository) {}


    async upsertListing(dto: CleanedDTO, action: 'INSERT' | 'UPDATE'): Promise<{ listingId: string }> {
        return this.ingestionRuns.upsertListing(dto, action);
    }

    // if part doesnt exist, create it : else check if this part is consistent with the existing part

    // if fitment doesnt exist, create it : else check if this fitment is consistent with the existing fitment

    // if interchange doesnt exist, create it : else check if this interchange is consistent with the existing interchange

    // if warehouse location doesnt exist, create it : else check if this warehouse location is consistent with the existing warehouse location

    // if vendor doesnt exist, create it : else check if this vendor is consistent with the existing vendor

    // if listing doesnt exist, create it : else check if this listing is consistent with the existing listing

    // if listing image doesnt exist, create it : else check if this listing image is consistent with the existing listing image
}