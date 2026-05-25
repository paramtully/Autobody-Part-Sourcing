import express, { type Request, type Response } from 'express';
import { db, partFitments, partCategoryEnum, partPositionEnum, fitmentConstraintEnum, fitments } from '@repo/db';
import { eq, sql, asc, desc } from 'drizzle-orm';

const router = express.Router();

router.get('/categories', (req: Request, res: Response) => {
    return res.status(200).json({categories: partCategoryEnum.enumValues});
});

router.get('/positions', (req: Request, res: Response) => {
    return res.status(200).json({positions: partPositionEnum.enumValues});
});

router.get('/constraints', (req: Request, res: Response) => {
    return res.status(200).json({constraints: fitmentConstraintEnum.enumValues});
});

router.get('/makes-with-models', (req: Request, res: Response) => {
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
    db.selectDistinct({ year: fitments.year }).from(fitments)
    .then((years: number[]) => res.status(200).json({ years : years }))
    .catch((err: Error) => {
        console.log('Failed to get years from database:', err);
        return res.status(500).json({error: 'Error: ' + err});
    });
});

// GET /fitment/vin/:vin — decodes a VIN via NHTSA vPIC (free, public, no auth)
router.get('/vin/:vin', async (req: Request, res: Response) => {
    const vin = (req.params?.vin as string)?.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
        return res.status(400).json({ error: 'Invalid VIN format' });
    }
    try {
        const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`);
        const data = await r.json();
        const get = (k: string) => data?.Results?.find((x: any) => x.Variable === k)?.Value ?? null;
        const year = get('Model Year');
        const make = get('Make');
        const model = get('Model');
        if (!year || !make || !model) {
            return res.status(404).json({ error: 'VIN could not be decoded' });
        }
        return res.status(200).json({
            year: parseInt(year, 10),
            make: String(make).toUpperCase(),
            model: String(model).toUpperCase(),
            trim: get('Trim'),
        });
    } catch (err) {
        console.error('VIN decode failed:', err);
        return res.status(502).json({ error: 'VIN decode service unavailable' });
    }
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