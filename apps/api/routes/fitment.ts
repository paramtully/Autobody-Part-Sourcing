import express, { type Request, type Response } from 'express';
import {
    db,
    partCategoryEnum,
    partPositionEnum,
    fitmentConstraintEnum,
    fitments,
    partFitments,
    parts,
    partIdentifiers,
    listings,
} from '@repo/db';
import { eq, sql, asc, desc, and } from 'drizzle-orm';
import { setStaticCacheHeaders } from '../lib/cacheHeaders.js';

const router = express.Router();

router.get('/categories', (_req: Request, res: Response) => {
    setStaticCacheHeaders(res);
    return res.status(200).json({categories: partCategoryEnum.enumValues});
});

router.get('/positions', (_req: Request, res: Response) => {
    setStaticCacheHeaders(res);
    return res.status(200).json({positions: partPositionEnum.enumValues});
});

router.get('/constraints', (_req: Request, res: Response) => {
    setStaticCacheHeaders(res);
    return res.status(200).json({constraints: fitmentConstraintEnum.enumValues});
});

router.get('/makes-with-models', (_req: Request, res: Response) => {
    setStaticCacheHeaders(res);
    db.select({
        make: fitments.make,
        models: sql<string[]>`array_agg(distinct ${fitments.model})`,
    })
    .from(fitments)
    .groupBy(fitments.make)
    .orderBy(fitments.make)
    .then((rows: any[]) => {
        const result: Record<string, string[]> = {};
        for (const row of rows) {
            result[row.make] = row.models;
        }
        return res.status(200).json(result);
    }).catch((err: Error) => {
        console.log('Failed to get makes with models from database:', err);
        return res.status(500).json({ error: 'Error: ' + err });
    });
});

router.get('/years', (req: Request, res: Response) => {
    const make = req.query.make?.toString().trim();
    const model = req.query.model?.toString().trim();
    if (!make || !model) {
        return res.status(400).json({ error: 'make and model are required' });
    }

    setStaticCacheHeaders(res);
    db.selectDistinct({ year: fitments.year })
        .from(fitments)
        .innerJoin(partFitments, eq(partFitments.fitmentId, fitments.id))
        .innerJoin(parts, eq(parts.id, partFitments.partId))
        .innerJoin(partIdentifiers, eq(partIdentifiers.partId, parts.id))
        .innerJoin(listings, eq(listings.partIdentifierId, partIdentifiers.id))
        .where(and(
            sql`lower(${fitments.make}) = lower(${make})`,
            sql`lower(${fitments.model}) = lower(${model})`,
        ))
        .orderBy(desc(fitments.year))
        .then((rows: { year: number }[]) => res.status(200).json({ years: rows.map(row => row.year) }))
        .catch((err: Error) => {
            console.log('Failed to get years from database:', err);
            return res.status(500).json({ error: 'Error: ' + err });
        });
});

// Returns one row per distinct (make, model, year, trim, engine, constraint)
// fitment record for the given part. The client coalesces consecutive years
// that share the same trim/engine/constraint into ranges for display, so each
// row in the rendered table is a precise (year range, make/model, trim, engine)
// vehicle fit — not a kitchen-sink aggregate.
router.get('/:partId', (req: Request, res: Response) => {
    const partId = req.params?.partId;

    db.select({
        make: fitments.make,
        model: fitments.model,
        year: fitments.year,
        trim: fitments.trim,
        engine: fitments.engine,
        constraint: fitments.constraint,
    })
        .from(partFitments)
        .innerJoin(fitments, eq(partFitments.fitmentId, fitments.id))
        .where(eq(partFitments.partId, partId as string))
        .orderBy(asc(fitments.make), asc(fitments.model), desc(fitments.year))
    .then((fitmentArray: any[]) => {
        return res.status(200).json({ fitments: fitmentArray });
    }).catch((err: Error) => {
        console.log('Search failed for fitments of part', partId, err);
        return res.status(500).json({error: 'Error:' + err});
    });
});

export default router;