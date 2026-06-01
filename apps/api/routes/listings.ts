import express, { type Request, type Response } from 'express';
import {
    db,
    listingImages,
    partFitments,
    vendors,
    listings,
    partIdentifiers,
    parts,
    fitments,
    partConditionEnum,
    partIdentifierTypeEnum,
    availabilityStatusEnum,
    fitmentSchema,
    normalizePartIdentifierValue,
} from '@repo/db';
import { getAffiliateBuilder } from '@repo/affiliate';
import { eq, and, gt, asc, desc, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

function decorateAffiliate<T extends { vendorId: string; sourceUrl: string | null }>(rows: T[]): T[] {
    for (const row of rows) {
        if (!row.sourceUrl) continue;
        // v1: fall back to canonical when builder returns null (env not set, wrong host, etc.)
        // future: swap `?? row.sourceUrl` for `?? null` to suppress unbuildable links.
        row.sourceUrl = getAffiliateBuilder(row.vendorId).wrap(row.sourceUrl) ?? row.sourceUrl;
    }
    return rows;
}

const router = express.Router();
const PAGE_SIZE = 50;
export const MAX_PAGES = 20;

// ── Shared filter/sort schema (applied to both search endpoints) ──────────────

const listingQuerySchema = z.object({
    cursor: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(MAX_PAGES).default(1),
    sort: z.enum(['price_asc', 'price_desc', 'eta_asc', 'reliability_desc', 'best_match']).optional(),
    partType: z.enum(partIdentifierTypeEnum.enumValues).optional(),
    condition: z.string().optional(),   // comma-separated PartCondition values
    vendorId: z.string().optional(),    // comma-separated vendor slugs
    availability: z.enum(['IN_STOCK', 'LOW_STOCK', 'BACKORDER', 'ANY']).default('ANY'),
    currency: z.enum(['USD', 'CAD']).optional(),
});

// ── Shared select columns (all downstream pages get the same shape) ────────────

const listingParams = {

    // ids
    id: listings.id,
    partId: partIdentifiers.partId,

    // part info
    partNumber: partIdentifiers.value,
    partName: parts.name,
    partCategory: parts.category,
    partPosition: parts.position,
    partDescription: parts.description,
    partWeightGrams: parts.weightGrams,
    partIsDiscontinued: parts.isDiscontinued,

    // listing info
    type: partIdentifiers.type,
    manufacturer: partIdentifiers.manufacturer,
    certification: partIdentifiers.certification,
    condition: listings.condition,
    description: listings.description,
    quantityAvailable: listings.quantityAvailable,
    availabilityStatus: listings.availabilityStatus,
    priceMinorMin: listings.priceMinorMin,
    priceMinorMax: listings.priceMinorMax,
    currency: listings.currency,
    estimatedDeliveryDate: listings.estimatedDeliveryDate,
    estimatedShipTimeHours: listings.estimatedShipTimeHours,
    sourceUrl: listings.sourceUrl,
    sourceVehicleVin: listings.sourceVehicleVin,
    sourceMileage: listings.sourceMileage,
    confidenceScore: listings.confidenceScore,
    lastVerifiedAt: listings.lastVerifiedAt,

    // vendor info (joined)
    vendorId: vendors.id,
    vendorName: vendors.name,
    vendorType: vendors.vendorType,
    vendorReliabilityScore: vendors.reliabilityScore,
    vendorOrderContactEmail: vendors.orderContactEmail,
};

// ── Helper: build filter predicates from parsed query ─────────────────────────

function buildFilterPredicates(
    query: z.infer<typeof listingQuerySchema>,
    cursor: string | undefined,
) {
    const predicates: (ReturnType<typeof eq> | undefined)[] = [];

    if (cursor) predicates.push(gt(listings.id, cursor));

    if (query.partType) predicates.push(eq(partIdentifiers.type, query.partType));

    if (query.condition) {
        const conditionValues = query.condition.split(',').map(s => s.trim()).filter(Boolean) as (typeof partConditionEnum.enumValues[number])[];
        const first = conditionValues[0];
        if (conditionValues.length === 1 && first) {
            predicates.push(eq(listings.condition, first));
        } else if (conditionValues.length > 1) {
            predicates.push(inArray(listings.condition, conditionValues));
        }
    }

    if (query.vendorId) {
        const vendorIds = query.vendorId.split(',').map(s => s.trim()).filter(Boolean);
        if (vendorIds.length === 1 && vendorIds[0]) {
            predicates.push(eq(vendors.id, vendorIds[0]));
        } else if (vendorIds.length > 1) {
            predicates.push(inArray(vendors.id, vendorIds));
        }
    }

    if (query.availability && query.availability !== 'ANY') {
        predicates.push(eq(listings.availabilityStatus, query.availability as typeof availabilityStatusEnum.enumValues[number]));
    }

    if (query.currency) {
        predicates.push(eq(listings.currency, query.currency as typeof listings.$inferSelect['currency']));
    }

    return predicates.filter((p): p is NonNullable<typeof p> => p !== undefined);
}

// ── Helper: build ORDER BY clause from sort param ─────────────────────────────

function buildOrderBy(sort: z.infer<typeof listingQuerySchema>['sort']) {
    switch (sort) {
        case 'price_asc':    return [asc(listings.priceMinorMin), asc(listings.id)];
        case 'price_desc':   return [desc(listings.priceMinorMin), asc(listings.id)];
        case 'eta_asc':      return [asc(listings.estimatedShipTimeHours), asc(listings.id)];
        case 'reliability_desc': return [desc(vendors.reliabilityScore), asc(listings.id)];
        case 'best_match':
        default:             return [desc(vendors.reliabilityScore), asc(listings.priceMinorMin), asc(listings.id)];
    }
}

function sendListingsPage(res: Response, rows: any[], page: number) {
    const decorated = decorateAffiliate(rows);
    const hasMore = rows.length === PAGE_SIZE && page < MAX_PAGES;
    return res.status(200).json({
        listings: decorated,
        hasMore,
        page,
        cursor: rows.length ? rows[rows.length - 1]!.id : null,
    });
}

// ── GET /listings/by-fitment ──────────────────────────────────────────────────

router.get('/by-fitment', (req: Request, res: Response) => {

    const fitment = fitmentSchema.safeParse(req.query);
    if (!fitment.success) {
        return res.status(400).json({ error: 'Fitment data is invalid' });
    }

    const query = listingQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({ error: 'Invalid query params', details: query.error.flatten() });
    }

    const { make, model, year, category, position, constraint } = fitment.data;
    const { cursor, page } = query.data;
    const filterPredicates = buildFilterPredicates(query.data, cursor);
    const orderBy = buildOrderBy(query.data.sort);

    // Cast Zod-validated enum strings — safe because safeParse guarantees enum membership
    type PartCategory = (typeof parts)['category']['_']['data'];
    type PartPosition = (typeof parts)['position']['_']['data'];
    type FitmentConstraint = (typeof fitments)['constraint']['_']['data'];

    // DISTINCT ON listings.id prevents duplicate rows when a part fits
    // multiple trims/engines for the same make/model/year — the join with
    // partFitments+fitments would otherwise multiply each listing by the
    // number of matching fitment rows.
    db.selectDistinctOn([listings.id], listingParams).from(listings)
        .innerJoin(vendors, eq(listings.vendorId, vendors.id))
        .innerJoin(partIdentifiers, eq(listings.partIdentifierId, partIdentifiers.id))
        .innerJoin(parts, eq(partIdentifiers.partId, parts.id))
        .innerJoin(partFitments, eq(parts.id, partFitments.partId))
        .innerJoin(fitments, eq(partFitments.fitmentId, fitments.id))
        .where(and(
            // Case-insensitive: wizard dropdowns reflect DB stored case (mixed)
            // while fitmentSchema upper-cases the submitted value.
            sql`lower(${fitments.make}) = lower(${make})`,
            sql`lower(${fitments.model}) = lower(${model})`,
            eq(fitments.year, year),
            category ? eq(parts.category, category as PartCategory) : undefined,
            position ? eq(parts.position, position as PartPosition) : undefined,
            constraint ? eq(fitments.constraint, constraint as FitmentConstraint) : undefined,
            ...filterPredicates,
        ))
        .orderBy(listings.id, ...orderBy)
        .limit(PAGE_SIZE)
        .then((rows: any[]) => sendListingsPage(res, rows, page))
        .catch((err: Error) => {
            console.error('Listing search failed:', err);
            return res.status(500).json({ error: 'Error: ' + err.message });
        });
});

// ── GET /listings/by-part-number/:partNumber ──────────────────────────────────

router.get('/by-part-number/:partNumber', async (req: Request, res: Response) => {

    const partNumber = normalizePartIdentifierValue(req.params?.partNumber as string ?? '');

    const query = listingQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({ error: 'Invalid query params', details: query.error.flatten() });
    }

    const { cursor, page } = query.data;
    const filterPredicates = buildFilterPredicates(query.data, cursor);
    const orderBy = buildOrderBy(query.data.sort);

    try {
        const [part] = await db.select({ partId: partIdentifiers.partId }).from(partIdentifiers)
            .where(eq(partIdentifiers.value, partNumber))
            .limit(1);

        if (!part) {
            return res.status(404).json({ error: 'Part not found for part number: ' + partNumber });
        }

        const result = await db.select(listingParams).from(listings)
            .innerJoin(vendors, eq(listings.vendorId, vendors.id))
            .innerJoin(partIdentifiers, eq(listings.partIdentifierId, partIdentifiers.id))
            .innerJoin(parts, eq(partIdentifiers.partId, parts.id))
            .where(and(
                eq(partIdentifiers.partId, part.partId),
                ...filterPredicates,
            ))
            .orderBy(...orderBy)
            .limit(PAGE_SIZE);

        return sendListingsPage(res, result, page);

    } catch (err: unknown) {
        console.error('Listing search failed:', err);
        return res.status(500).json({ error: 'Error: ' + err });
    }
});

// ── GET /listings/images/:listingId ──────────────────────────────────────────

router.get('/images/:listingId', (req: Request, res: Response) => {
    const listingId = req.params?.listingId;
    if (!listingId) {
        return res.status(400).json({ error: 'Listing ID is required' });
    }

    db.select({
        url: listingImages.url,
        imageType: listingImages.imageType,
        sortOrder: listingImages.sortOrder,
    }).from(listingImages)
        .where(eq(listingImages.listingId, listingId as string))
        .orderBy(asc(listingImages.sortOrder))
        .then((images: any[]) => {
            return res.status(200).json({ listingId, listingImages: images });
        }).catch((err: Error) => {
            console.error('Search failed for listing images:', err);
            return res.status(500).json({ error: 'Error: ' + err });
        });
});

export default router;
