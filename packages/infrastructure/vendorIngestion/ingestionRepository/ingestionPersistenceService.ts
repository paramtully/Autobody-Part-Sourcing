/**
 * IngestionPersistenceService
 *
 * Orchestrates the full flow from CleanedDTO to database writes:
 *
 *   1. Validate vendor exists
 *   2. Upsert warehouse location + link to vendor
 *   3. Resolve or create Part (with consistency check)
 *   4. Upsert Fitment + link to Part
 *   5. Upsert Interchange + Membership (with critical consistency check)
 *   6. Upsert Listing
 *   7. Save listing images
 *
 * Design:
 * - Receives all repository interfaces via constructor (pure DI).
 * - Uses EntityExtractor (pure functions) to project CleanedDTO → entity shapes.
 * - Uses ConsistencyChecker to gate each upsert.
 * - If any check yields REJECTED, throws ConsistencyRejectionError.
 * - Returns UpsertListingResult with full audit trail.
 *
 * The domain interfaces (Part, Vendor, WarehouseLocation) do not declare
 * an `id` field, but repository implementations attach one at runtime.
 * We use a local `WithId<T>` helper to capture this.
 */

import type { CleanedDTO } from '../cleaning/cleanedDTO';
import type { VendorRepository } from '@interfaces/repositories/vendorRepository';
import type { PartRepository } from '@interfaces/repositories/partRepository';
import type { FitmentRepository } from '@interfaces/repositories/fitmentRepository';
import type { InterchangeRepository } from '@interfaces/repositories/interchangeRepository';
import type { InterchangeMembershipRepository } from '@interfaces/repositories/interchangeMembershipRepository';
import type { ListingRepository } from '@interfaces/repositories/listingRepository';
import type { ListingImageRepository } from '@interfaces/repositories/listingImageRepository';
import type { WarehouseLocationRepository } from '@interfaces/repositories/warehouseLocationRepository';
import type { Interchange, InterchangeSystem } from '@domain/interchange/interchange';
import type Part from '@domain/part/part';
import type Vendor from '@domain/vendor/vendor';
import type WarehouseLocation from '@domain/warehouseLocation/warehouseLocation';
import type { ConsistencyChecker } from './consistencyChecker';
import type {
    ConsistencyCheckResult,
    UpsertListingResult,
    EntitiesCreated,
} from './consistencyResult';
import { ConsistencyRejectionError } from './consistencyResult';
import {
    extractWarehouseLocation,
    extractPartCandidate,
    extractFitment,
    extractInterchange,
    extractListingFields,
    extractListingImages,
} from './entityExtractor';

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Domain interfaces don't declare `id`, but repository implementations
 * attach one at runtime. This helper captures that pattern.
 */
type WithId<T> = T & { id: string };

// ─── Dependencies ────────────────────────────────────────────────────

export interface IngestionPersistenceServiceDeps {
    vendorRepo: VendorRepository;
    partRepo: PartRepository;
    fitmentRepo: FitmentRepository;
    interchangeRepo: InterchangeRepository;
    interchangeMembershipRepo: InterchangeMembershipRepository;
    listingRepo: ListingRepository;
    listingImageRepo: ListingImageRepository;
    warehouseLocationRepo: WarehouseLocationRepository;
    consistencyChecker: ConsistencyChecker;
}

// ─── Service ─────────────────────────────────────────────────────────

export class IngestionPersistenceService {
    private readonly vendorRepo: VendorRepository;
    private readonly partRepo: PartRepository;
    private readonly fitmentRepo: FitmentRepository;
    private readonly interchangeRepo: InterchangeRepository;
    private readonly interchangeMembershipRepo: InterchangeMembershipRepository;
    private readonly listingRepo: ListingRepository;
    private readonly listingImageRepo: ListingImageRepository;
    private readonly warehouseLocationRepo: WarehouseLocationRepository;
    private readonly consistencyChecker: ConsistencyChecker;

    constructor(deps: IngestionPersistenceServiceDeps) {
        this.vendorRepo = deps.vendorRepo;
        this.partRepo = deps.partRepo;
        this.fitmentRepo = deps.fitmentRepo;
        this.interchangeRepo = deps.interchangeRepo;
        this.interchangeMembershipRepo = deps.interchangeMembershipRepo;
        this.listingRepo = deps.listingRepo;
        this.listingImageRepo = deps.listingImageRepo;
        this.warehouseLocationRepo = deps.warehouseLocationRepo;
        this.consistencyChecker = deps.consistencyChecker;
    }

    /**
     * Persist a CleanedDTO by resolving/upserting all constituent entities
     * in FK-dependency order, checking consistency at each step.
     *
     * @throws ConsistencyRejectionError if any check yields REJECTED.
     */
    async persistListing(
        dto: CleanedDTO,
        _action: 'INSERT' | 'UPDATE',
    ): Promise<UpsertListingResult> {
        const checks: ConsistencyCheckResult[] = [];
        const created: Mutable<EntitiesCreated> = {
            vendor: false,
            warehouseLocation: false,
            part: false,
            fitment: false,
            interchange: false,
            interchangeMembership: false,
            listing: false,
            listingImages: false,
        };

        // ── 1. Vendor (must already exist) ──────────────────────────
        const vendor = await this.resolveVendor(dto.vendorId, checks);

        // ── 2. Warehouse Location ───────────────────────────────────
        const warehouseLocation = await this.resolveWarehouseLocation(
            dto,
            vendor,
            checks,
            created,
        );

        // ── 3. Part ─────────────────────────────────────────────────
        const part = await this.resolvePart(dto, checks, created);

        // ── 4. Fitment ──────────────────────────────────────────────
        await this.resolveFitment(dto, part, checks, created);

        // ── 5. Interchange + Membership ─────────────────────────────
        await this.resolveInterchange(dto, part, checks, created);

        // ── 6. Listing ──────────────────────────────────────────────
        const listing = await this.resolveListing(
            dto,
            vendor,
            part,
            warehouseLocation,
            checks,
            created,
        );

        // ── 7. Listing Images ───────────────────────────────────────
        await this.resolveListingImages(dto, listing.id, checks, created);

        return {
            listingId: listing.id,
            partId: (part as WithId<Part>).id,
            consistencyChecks: checks,
            entitiesCreated: created,
        };
    }

    // ─── Private resolution methods ────────────────────────────────────

    /**
     * Step 1: Validate vendor exists.
     */
    private async resolveVendor(
        vendorId: string,
        checks: ConsistencyCheckResult[],
    ): Promise<WithId<Vendor>> {
        const vendor = await this.vendorRepo.findById(vendorId);
        const check = this.consistencyChecker.checkVendorExists(vendor);
        checks.push(check);

        if (check.verdict === 'REJECTED') {
            throw new ConsistencyRejectionError(check, checks);
        }

        // Runtime: vendor has id from the DB.
        return vendor as WithId<Vendor>;
    }

    /**
     * Step 2: Upsert warehouse location and link to vendor.
     */
    private async resolveWarehouseLocation(
        dto: CleanedDTO,
        vendor: WithId<Vendor>,
        checks: ConsistencyCheckResult[],
        created: Mutable<EntitiesCreated>,
    ): Promise<WithId<WarehouseLocation> | undefined> {
        const extracted = extractWarehouseLocation(dto);
        if (!extracted) return undefined;

        // Check if this location already exists.
        const existing = await this.warehouseLocationRepo.findByLocation(extracted);
        const isNew = !existing;

        // Upsert (idempotent).
        const location = (await this.warehouseLocationRepo.upsert(
            extracted,
        )) as WithId<WarehouseLocation>;

        // Link vendor → location (idempotent).
        await this.warehouseLocationRepo.linkVendorToLocation(
            vendor.id,
            location.id,
        );

        created.warehouseLocation = isNew;

        checks.push({
            entity: 'WAREHOUSE_LOCATION',
            verdict: 'CONSISTENT',
            resolution: isNew
                ? 'Created new warehouse location.'
                : 'Using existing warehouse location.',
        });

        return location;
    }

    /**
     * Step 3: Resolve part by searching normalizedPartNumberCandidates.
     * If no match, create a new Part using partMetadata from the DTO.
     */
    private async resolvePart(
        dto: CleanedDTO,
        checks: ConsistencyCheckResult[],
        created: Mutable<EntitiesCreated>,
    ): Promise<WithId<Part>> {
        const candidate = extractPartCandidate(dto);

        // Try to find an existing Part by any of the candidate part numbers.
        let existingPart: Part | null = null;
        for (const partNumber of candidate.partNumberCandidates) {
            const results = (await this.partRepo.findByOemPartNumber(
                partNumber,
            )) as Part[];
            if (results.length > 0) {
                existingPart = results[0];
                break;
            }

            const aftermarketResults = (await this.partRepo.findByAftermarketPartNumber(
                partNumber,
            )) as Part[];
            if (aftermarketResults.length > 0) {
                existingPart = aftermarketResults[0];
                break;
            }
        }

        // Run consistency check.
        const check = this.consistencyChecker.checkPart(existingPart, candidate);
        checks.push(check);

        if (check.verdict === 'REJECTED') {
            throw new ConsistencyRejectionError(check, checks);
        }

        // If part exists, use it.
        if (existingPart) {
            created.part = false;
            return existingPart as WithId<Part>;
        }

        // No match — create a new Part.
        if (!candidate.metadata) {
            const rejectCheck: ConsistencyCheckResult = {
                entity: 'PART',
                verdict: 'REJECTED',
                resolution:
                    'No existing part found and no partMetadata in DTO to create one.',
            };
            checks.push(rejectCheck);
            throw new ConsistencyRejectionError(rejectCheck, checks);
        }

        const newPart = (await this.partRepo.upsert({
            name: candidate.metadata.name,
            category: candidate.metadata.category,
            position: candidate.metadata.position,
            description: candidate.metadata.description,
            partIdentifiers: [],
        })) as WithId<Part>;

        // Register all part number candidates as identifiers.
        for (const partNumber of candidate.partNumberCandidates) {
            await this.partRepo.addIdentifier(newPart.id, {
                type: 'OEM',
                value: partNumber,
                manufacturer: '', // Will be enriched later
            });
        }

        created.part = true;
        return newPart;
    }

    /**
     * Step 4: Upsert fitment and link to part.
     */
    private async resolveFitment(
        dto: CleanedDTO,
        part: WithId<Part>,
        checks: ConsistencyCheckResult[],
        created: Mutable<EntitiesCreated>,
    ): Promise<void> {
        const fitmentData = extractFitment(dto);
        if (!fitmentData) return;

        // Fitment upsert is idempotent on (make, model, year, constraint, trim, engine).
        const fitment = await this.fitmentRepo.upsert(fitmentData);
        const fitmentId = (fitment as WithId<typeof fitment>).id;

        // Link part → fitment (idempotent).
        await this.fitmentRepo.linkPartToFitment(part.id, fitmentId);

        created.fitment = true;
        checks.push({
            entity: 'FITMENT',
            verdict: 'CONSISTENT',
            resolution: 'Fitment upserted and linked to part.',
        });
    }

    /**
     * Step 5: Upsert interchange (with critical consistency check) + membership.
     */
    private async resolveInterchange(
        dto: CleanedDTO,
        part: WithId<Part>,
        checks: ConsistencyCheckResult[],
        created: Mutable<EntitiesCreated>,
    ): Promise<void> {
        const interchangeData = extractInterchange(dto);
        if (!interchangeData) return;

        // Fetch all interchanges the part currently belongs to.
        const existingInterchanges = (await this.interchangeRepo.findByPart(
            part.id,
        )) as Interchange[];

        // Critical consistency check.
        const check = this.consistencyChecker.checkInterchange(
            existingInterchanges,
            interchangeData,
            part.id,
        );
        checks.push(check);

        if (check.verdict === 'REJECTED') {
            throw new ConsistencyRejectionError(check, checks);
        }

        // Upsert the interchange itself (idempotent on system + code).
        const interchange = await this.interchangeRepo.upsert({
            system: interchangeData.system as InterchangeSystem,
            code: interchangeData.code,
        });
        const interchangeId = (interchange as WithId<typeof interchange>).id;

        created.interchange = true;

        // Upsert membership (idempotent on partId + interchangeId).
        await this.interchangeMembershipRepo.upsert({
            id: undefined,
            partId: part.id,
            interchangeId,
        });

        created.interchangeMembership = true;
        checks.push({
            entity: 'INTERCHANGE_MEMBERSHIP',
            verdict: 'CONSISTENT',
            resolution: 'Interchange membership upserted.',
        });
    }

    /**
     * Step 6: Upsert the listing itself.
     */
    private async resolveListing(
        dto: CleanedDTO,
        vendor: WithId<Vendor>,
        part: WithId<Part>,
        warehouseLocation: WithId<WarehouseLocation> | undefined,
        checks: ConsistencyCheckResult[],
        created: Mutable<EntitiesCreated>,
    ): Promise<{ id: string }> {
        const listingFields = extractListingFields(
            dto,
            vendor as Vendor,
            part as Part,
            warehouseLocation as WarehouseLocation | undefined,
        );

        const listing = await this.listingRepo.upsert(listingFields);

        created.listing = true;
        checks.push({
            entity: 'LISTING',
            verdict: 'CONSISTENT',
            resolution: 'Listing upserted.',
        });

        return listing;
    }

    /**
     * Step 7: Save listing images (replaces all existing images).
     */
    private async resolveListingImages(
        dto: CleanedDTO,
        listingId: string,
        checks: ConsistencyCheckResult[],
        created: Mutable<EntitiesCreated>,
    ): Promise<void> {
        const images = extractListingImages(dto);
        if (images.length === 0) return;

        await this.listingImageRepo.saveListingImages(listingId, images);

        created.listingImages = true;
        checks.push({
            entity: 'LISTING_IMAGE',
            verdict: 'CONSISTENT',
            resolution: `Saved ${images.length} listing image(s).`,
        });
    }
}

// ─── Utility types ───────────────────────────────────────────────────

/** Makes all properties of T mutable (removes readonly). */
type Mutable<T> = { -readonly [P in keyof T]: T[P] };
