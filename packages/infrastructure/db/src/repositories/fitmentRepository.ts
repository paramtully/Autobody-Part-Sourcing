import { db } from '../../infrastructure/db/src/db';
import { fitments, partFitments } from '../../infrastructure/db/src/schema';
import { eq, inArray } from 'drizzle-orm';
import type { Fitment, FitmentConstraint } from '@domain/fitment/fitment';

/**
 * Get all fitments for a part, aggregated from normalized fitment rows.
 * Groups multiple fitment rows into domain Fitment objects with arrays.
 */
export async function getFitmentsForPart(partId: string): Promise<Fitment[]> {
    // Get all fitment IDs for this part
    const partFitmentRows = await db
        .select({ fitmentId: partFitments.fitmentId })
        .from(partFitments)
        .where(eq(partFitments.partId, partId));

    if (partFitmentRows.length === 0) {
        return [];
    }

    const fitmentIds = partFitmentRows.map((row) => row.fitmentId);

    // Get all fitment rows
    const fitmentRows = await db
        .select()
        .from(fitments)
        .where(inArray(fitments.id, fitmentIds));

    // Group by (make, model) and aggregate
    const fitmentMap = new Map<string, Fitment>();

    for (const row of fitmentRows) {
        const key = `${row.make}|${row.model}`;

        if (!fitmentMap.has(key)) {
            fitmentMap.set(key, {
                make: row.make,
                model: row.model,
                yearFrom: row.year,
                yearTo: row.year,
                trims: [],
                constraints: [],
                engine: row.engine ?? undefined,
            });
        }

        const fitment = fitmentMap.get(key)!;

        // Update year range
        if (row.year < fitment.yearFrom!) {
            fitment.yearFrom = row.year;
        }
        if (row.year > fitment.yearTo!) {
            fitment.yearTo = row.year;
        }

        // Add trim if not already present
        if (row.trim && !fitment.trims?.includes(row.trim)) {
            fitment.trims = fitment.trims || [];
            fitment.trims.push(row.trim);
        }

        // Add constraint if not already present
        if (row.constraint && !fitment.constraints?.includes(row.constraint as FitmentConstraint)) {
            fitment.constraints = fitment.constraints || [];
            fitment.constraints.push(row.constraint as FitmentConstraint);
        }

        // Engine: use first non-null value or most common
        if (row.engine && !fitment.engine) {
            fitment.engine = row.engine;
        }
    }

    return Array.from(fitmentMap.values());
}

/**
 * Get a single fitment by ID (returns all normalized rows for that fitment).
 * Note: This is less common - usually you want getFitmentsForPart.
 */
export async function getFitmentById(fitmentId: string): Promise<Fitment | null> {
    const rows = await db
        .select()
        .from(fitments)
        .where(eq(fitments.id, fitmentId));

    if (rows.length === 0) {
        return null;
    }

    // Aggregate rows into single fitment
    const firstRow = rows[0];
    const fitment: Fitment = {
        make: firstRow.make,
        model: firstRow.model,
        yearFrom: firstRow.year,
        yearTo: firstRow.year,
        trims: [],
        constraints: [],
        engine: firstRow.engine ?? undefined,
    };

    for (const row of rows) {
        if (row.year < fitment.yearFrom!) {
            fitment.yearFrom = row.year;
        }
        if (row.year > fitment.yearTo!) {
            fitment.yearTo = row.year;
        }

        if (row.trim && !fitment.trims?.includes(row.trim)) {
            fitment.trims = fitment.trims || [];
            fitment.trims.push(row.trim);
        }

        if (row.constraint && !fitment.constraints?.includes(row.constraint as FitmentConstraint)) {
            fitment.constraints = fitment.constraints || [];
            fitment.constraints.push(row.constraint as FitmentConstraint);
        }

        if (row.engine && !fitment.engine) {
            fitment.engine = row.engine;
        }
    }

    return fitment;
}
