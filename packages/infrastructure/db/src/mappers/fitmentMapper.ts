import type { Fitment, FitmentConstraint } from '@domain/fitment/fitment';
import type { fitments } from '../schema';

type FitmentRow = typeof fitments.$inferSelect;

/**
 * Aggregate normalized fitment rows into a single domain Fitment object
 * Groups rows by (make, model) and aggregates year ranges, trims, constraints, and engine
 */
export function aggregateFitmentRows(rows: FitmentRow[]): Fitment {
    if (rows.length === 0) {
        throw new Error('Cannot aggregate empty fitment rows');
    }

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
        // Update year range
        if (row.year < fitment.yearFrom) {
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

        // Engine: use first non-null value
        if (row.engine && !fitment.engine) {
            fitment.engine = row.engine;
        }
    }

    return fitment;
}

/**
 * Expand domain Fitment into normalized database rows
 * Creates one row per combination of year, trim, and constraint
 */
export function expandFitmentToRows(fitment: Fitment): Array<{
    make: string;
    model: string;
    year: number;
    constraint: string | null;
    trim: string | null;
    engine: string | null;
}> {
    const rows: Array<{
        make: string;
        model: string;
        year: number;
        constraint: string | null;
        trim: string | null;
        engine: string | null;
    }> = [];

    const yearFrom = fitment.yearFrom;
    const yearTo = fitment.yearTo ?? fitment.yearFrom;
    const trims = fitment.trims && fitment.trims.length > 0 ? fitment.trims : [null];
    const constraints = fitment.constraints && fitment.constraints.length > 0 
        ? fitment.constraints.map(c => c as string) 
        : [null];

    // Generate all combinations
    for (let year = yearFrom; year <= yearTo; year++) {
        for (const trim of trims) {
            for (const constraint of constraints) {
                rows.push({
                    make: fitment.make,
                    model: fitment.model,
                    year,
                    constraint: constraint ?? null,
                    trim: trim ?? null,
                    engine: fitment.engine ?? null,
                });
            }
        }
    }

    // If no trims or constraints, ensure at least one row per year
    if (rows.length === 0) {
        for (let year = yearFrom; year <= yearTo; year++) {
            rows.push({
                make: fitment.make,
                model: fitment.model,
                year,
                constraint: null,
                trim: null,
                engine: fitment.engine ?? null,
            });
        }
    }

    return rows;
}
