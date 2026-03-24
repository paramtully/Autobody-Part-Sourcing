import express, { type Request, type Response } from 'express';
import { db, listingImages, partFitments } from '@repo/db';
import { listings, partIdentifiers, parts, fitments } from '@repo/db/models';
import { eq, inArray, and, gt, asc } from 'drizzle-orm';
import { fitmentSchema } from '@repo/db/schema/fitment.schema';

const router = express.Router();
const PAGE_SIZE = 50;
const listingParams = {

    // id
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
    priceMinorMin: listings.priceMinorMin,
    priceMinorMax: listings.priceMinorMax,
    currency: listings.currency,
    estimatedDeliveryDate: listings.estimatedDeliveryDate,
    sourceVehicleVin: listings.sourceVehicleVin,
    sourceMileage: listings.sourceMileage,

};

function parseCursor(raw: unknown): number | undefined {
    if (!raw) return undefined;
    const n = parseInt(raw as string);
    if (isNaN(n)) throw new Error('Invalid cursor');
    return n;
}

function paginatedResponse(rows: any[], pageSize: number = PAGE_SIZE) {
    return {
      listings: rows,
      hasMore: rows.length === pageSize,
      cursor: rows.length ? rows[rows.length - 1].id : null,
    };
}

// search paginated listings by fitment
router.get("/by-fitment", (req: Request, res: Response) => {

    const cursor = parseCursor(req.query?.cursor);

    // validate fitment from query params
    const fitment = fitmentSchema.safeParse(req.query);

    if (!fitment.success) {
        return res.status(400).json({ error: 'Fitment data is inavlid'})
    }

    const { make, model, year, category, position, constraint } = fitment.data;

    db.select(listingParams).from(listings)
        .innerJoin(partIdentifiers, eq(listings.partIdentifierId, partIdentifiers.id))
        .innerJoin(parts, eq(partIdentifiers.partId, parts.id))
        .innerJoin(partFitments, eq(parts.id, partFitments.partId))
        .innerJoin(fitments, eq(partFitments.fitmentId, fitments.id))
        .where(
            and(
                eq(fitments.make, make),
                eq(fitments.model, model),
                eq(fitments.year, year),
                category ? eq(parts.category, category) : undefined,
                position ? eq(parts.position, position) : undefined,
                constraint ? eq(fitments.constraint, constraint) : undefined,
                
                cursor ? gt(listings.id, cursor) : undefined,))
        .orderBy(asc(listings.id))
        .limit(PAGE_SIZE)
    .then((listings: any[]) => {
        return res.status(200).json({
            listings: listings, 
            hasMore: listings.length === PAGE_SIZE,
            cursor: listings.length ? listings[listings.length - 1].id : null
        });
    }).catch((err: Error) => {
        console.error('Listing search failed:', err);
        return res.status(500).json({ error: 'Error: ' + err.message });
    });
});

// search paginated listings by part number and page (1 indexed)
router.get('/by-part-number/:partNumber', async (req: Request, res: Response) => {

    const cursor = req.query?.cursor ? parseInt(req.query?.cursor as string) : undefined;
    const partNumber: string = (req.params?.partNumber as string)?.trim().toUpperCase();

    if (cursor && (isNaN(cursor))) {
        return res.status(400).json({ error: 'Invalid cursor' });
    }

    try {
        // get partId
        const [part] = await db.select({ partId: partIdentifiers.partId }).from(partIdentifiers)
            .where(eq(partIdentifiers.value, partNumber))
            .limit(1);

        if (!part) {
            return res.status(404).json({ error: 'Part not found for part number: ' + partNumber });
        }    

        // get listings
        const result = await db.select(listingParams).from(listings)
            .innerJoin(partIdentifiers, eq(listings.partIdentifierId, partIdentifiers.id))
            .innerJoin(parts, eq(partIdentifiers.partId, parts.id))
            .where(
                and(
                    cursor ? gt(listings.id, cursor) : undefined,
                    eq(partIdentifiers.partId, part.partId)))
            .orderBy(asc(listings.id))
            .limit(PAGE_SIZE);
        
        // this is a 1 query version of the above 2 step query
        // const result2 = await db.select(listingParams).from(listings)
        // .innerJoin(partIdentifiers, eq(listings.partIdentifier, partIdentifiers.id))
        // .where(
        //     and(
        //         cursor ? gt(listings.id, cursor) : undefined,
        //         inArray(
        //             partIdentifiers.partId,
        //             db.select(partIdentifiers.partId).from(partIdentifiers)
        //                 .where(eq(partIdentifiers.value, partNumber))
        //         )))
        // .orderBy(asc(listings.id))
        // .limit(PAGE_SIZE);

        return res.status(200).json({ 
            listings: result, 
            hasMore: result.length === PAGE_SIZE,
            cursor: listings.length ? listings[listings.length - 1].id : null
        });

    } catch(err: unknown) {
        console.error('Listing search failed:', err);
        return res.status(500).json({ error: 'Error: ' + err });
    };
});

// get images associated with a listing
router.get('/images/:listingId', (req: Request, res: Response) => {
    const listingId = req.params?.listingId;
    if (!listingId) {
        return res.status(400).json({ error: 'Listing ID is required' });
    }
    
    db.select({
        url: listingImages.url,
        imageType: listingImages.imageType,
        sortOrder: listingImages.sortOrder
    }).from(listingImages)
        .where(eq(listingImages.id, listingId as string))
    .then((images: any[]) => {
        return res.status(200).json({
            listingId: listingId,
            listingImages: images
        });
    }).catch((err: Error) => {
        console.log('Search failed for listing images:', err);
        return res.status(500).json({ error: 'Error: ' + err });
    });
    
});

