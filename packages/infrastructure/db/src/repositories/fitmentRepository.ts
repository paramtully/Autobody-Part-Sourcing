import { db } from '../db';
import { fitments, partFitments, parts } from '../schema';
import { eq, and, inArray, gte, lte, sql } from 'drizzle-orm';
import type { FitmentRepository } from '@interfaces/repositories/fitmentRepository';
import type { Fitment } from '@domain/fitment/fitment';
import { PartCategory } from '@domain/part/partCategory';
import type { PaginationParams, PaginatedResult } from '@interfaces/repositories/pagination';
import { aggregateFitmentRows, expandFitmentToRows } from '../mappers';
import { normalizeLimit, createPaginatedResult, encodeCursor, decodeCursor } from './paginationHelper';

export class FitmentRepositoryImpl implements FitmentRepository {
    async findById(id: string): Promise<Fitment | null> {
        const rows = await db
            .select()
            .from(fitments)
            .where(eq(fitments.id, id));

        if (rows.length === 0) {
            return null;
        }

        return aggregateFitmentRows(rows);
    }

    async findByPart(
        partId: string,
        pagination?: PaginationParams
    ): Promise<Fitment[] | PaginatedResult<Fitment>> {
        // Get all fitment IDs for this part
        const partFitmentRows = await db
            .select({ fitmentId: partFitments.fitmentId })
            .from(partFitments)
            .where(eq(partFitments.partId, partId));

        if (partFitmentRows.length === 0) {
            const items: Fitment[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
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
            if (row.constraint && !fitment.constraints?.includes(row.constraint as any)) {
                fitment.constraints = fitment.constraints || [];
                fitment.constraints.push(row.constraint as any);
            }

            // Engine: use first non-null value
            if (row.engine && !fitment.engine) {
                fitment.engine = row.engine;
            }
        }

        const items = Array.from(fitmentMap.values());

        // Apply pagination if requested
        if (!pagination) return items;

        const limit = normalizeLimit(pagination.limit);
        const offset = pagination.offset ?? 0;
        const paginatedItems = items.slice(offset, offset + limit);
        const hasMore = items.length > offset + limit;

        return createPaginatedResult(paginatedItems, pagination, hasMore);
    }

    async findPartsByFitment(
        fitment: Fitment,
        category?: PartCategory,
        pagination?: PaginationParams
    ): Promise<string[] | PaginatedResult<string>> {
        // Find fitment IDs matching criteria
        let fitmentQuery = db
            .select({ id: fitments.id })
            .from(fitments)
            .where(
                and(
                    eq(fitments.make, fitment.make),
                    eq(fitments.model, fitment.model),
                    gte(fitments.year, fitment.yearFrom),
                    lte(fitments.year, fitment.yearTo ?? fitment.yearFrom)
                )
            );

        const fitmentRows = await fitmentQuery;
        const fitmentIds = fitmentRows.map((row) => row.id);

        if (fitmentIds.length === 0) {
            const items: string[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        // Find part IDs through partFitments
        const limit = normalizeLimit(pagination?.limit);
        let cursorPartId: string | undefined;

        if (pagination?.cursor) {
            const cursor = decodeCursor(pagination.cursor) as { partId?: string };
            cursorPartId = cursor.partId;
        }

        let partFitmentQuery = db
            .select({ partId: partFitments.partId })
            .from(partFitments)
            .where(partFitments.fitmentId.in(fitmentIds));

        if (cursorPartId) {
            partFitmentQuery = partFitmentQuery.where(
                and(sql`${partFitments.partId} > ${cursorPartId}`)
            );
        }

        partFitmentQuery = partFitmentQuery.limit(limit + 1);

        const partFitmentRows = await partFitmentQuery;
        const hasMore = partFitmentRows.length > limit;
        const pagePartFitments = hasMore ? partFitmentRows.slice(0, limit) : partFitmentRows;
        let partIds = pagePartFitments.map((row) => row.partId);

        // Filter by category if provided
        if (category && partIds.length > 0) {
            const categoryRows = await db
                .select({ id: parts.id })
                .from(parts)
                .where(and(parts.id.in(partIds), eq(parts.category, category)));
            partIds = categoryRows.map((row) => row.id);
        }

        if (!pagination) return partIds;

        const nextCursor =
            hasMore && pagePartFitments.length > 0
                ? encodeCursor({ partId: pagePartFitments[pagePartFitments.length - 1].partId })
                : null;

        return createPaginatedResult(partIds, pagination, hasMore, nextCursor);
    }

    async upsert(fitment: Fitment): Promise<Fitment> {
        // Expand fitment to normalized rows
        const rowsToInsert = expandFitmentToRows(fitment);

        // Insert all rows (with conflict handling)
        const insertedRows: Array<typeof fitments.$inferSelect> = [];
        for (const row of rowsToInsert) {
            const [inserted] = await db
                .insert(fitments)
                .values(row)
                .onConflictDoNothing()
                .returning();
            if (inserted) {
                insertedRows.push(inserted);
            }
        }

        if (insertedRows.length === 0) {
            // All rows already exist, fetch existing
            const existingRows = await db
                .select()
                .from(fitments)
                .where(
                    and(
                        eq(fitments.make, fitment.make),
                        eq(fitments.model, fitment.model),
                        gte(fitments.year, fitment.yearFrom),
                        lte(fitments.year, fitment.yearTo ?? fitment.yearFrom)
                    )
                );
            return aggregateFitmentRows(existingRows);
        }

        // Get all rows for this fitment (make/model) to aggregate
        const allRows = await db
            .select()
            .from(fitments)
            .where(
                and(
                    eq(fitments.make, fitment.make),
                    eq(fitments.model, fitment.model),
                    gte(fitments.year, fitment.yearFrom),
                    lte(fitments.year, fitment.yearTo ?? fitment.yearFrom)
                )
            );

        return aggregateFitmentRows(allRows);
    }

    async linkPartToFitment(partId: string, fitmentId: string): Promise<void> {
        await db
            .insert(partFitments)
            .values({
                partId,
                fitmentId,
            })
            .onConflictDoNothing();
    }
}
