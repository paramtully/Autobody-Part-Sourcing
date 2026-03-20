import express, { type Request, type Response } from 'express';
import { partCategoryEnum, partPositionEnum, fitmentConstraintEnum } from '@repo/db/models/enums';
import { db, partFitments } from '@repo/db';
import { fitments } from '@repo/db/models/fitments';
import { eq, max, min, sql } from 'drizzle-orm';

const router = express.Router();

type FitmentResult = {
    make: string;
    model: string;
    constraint: string | null;
    minYear: number;
    maxYear: number;
    trims: string[];   // ✅ no null
    engines: string[]; // ✅ no null
};

router.get('/categories', (req: Request, res: Response) => {
    return res.status(200).json({categories: partCategoryEnum.enumValues});
});

router.get('/positions', (req: Request, res: Response) => {
    return res.status(200).json({positions: partPositionEnum.enumValues});
});

router.get('/constraints', (req: Request, res: Response) => {
    return res.status(200).json({constraints: fitmentConstraintEnum.enumValues});
});

router.get('/makes-with-models', async (req: Request, res: Response) => {
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

// gets fitments for a part (assumes missing years within window are missing data. ie honda civic 10-12, 14-16 -> honda civic 10-16)
router.get('/:partId', (req: Request, res: Response) => {
    const partId = req.params?.partId;

    db.select({
        make: fitments.make,
        model: fitments.model,
        constraints: fitments.constrains,
        minYear: min(fitments.year),
        maxYear: max(fitments.year),
        trims: sql<string[]>`
            coalesce(
                array_agg(distinct ${fitments.trim})
                filter (where ${fitments.engine} is not null),
                '{}'::text[]
            )`,
        engine: sql<string[]>`
            coalesc(
                array_agg(distinct ${fitments.engine})
                filter (where ${fitments.engine} is not null),
                '{}'::text[]
            )
        `,
    })
        .from(partFitments)
        .innerJoin(fitments, eq(partFitments.fitmentId, fitments.id))
        .where(eq(partFitments.partId, partId as string))
        .groupBy(fitments.make, fitments.model, fitments.constraints)
    .then((fitmentArray: any[]) => {
        return res.status(200).json({ fitments: fitmentArray });
    }).catch((err: Error) => {
        console.log('Search failed for fitements of part', partId, err);
        return res.status(500).json({error: 'Error:' + err});
    });
});