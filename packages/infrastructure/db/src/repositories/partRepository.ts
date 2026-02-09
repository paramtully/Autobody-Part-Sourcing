import { db } from '../db';
import {
    parts,
    partIdentifiers,
    partDimensions,
    partFitments,
    fitments,
    interchangeMemberships,
    interchanges,
} from '../schema';
import { eq, and, or, inArray, gte, lte, sql } from 'drizzle-orm';
import type { PartRepository } from '@interfaces/repositories/partRepository';
import type Part from '@domain/part/part';
import type { PartIdentifier } from '@domain/part/partIdentifier';
import type Dimensions from '@domain/part/dimensions';
import type { Fitment } from '@domain/fitment/fitment';
import { PartCategory } from '@domain/part/partCategory';
import { InterchangeSystem } from '@domain/interchange/interchange';
import type { PaginationParams, PaginatedResult } from '@interfaces/repositories/pagination';
import { toDomainPart, toDbPartInsert, type PartAggregateData } from '../mappers';
import { normalizeLimit, createPaginatedResult, encodeCursor, decodeCursor } from './paginationHelper';

export class PartRepositoryImpl implements PartRepository {
    async findById(id: string): Promise<Part | null> {
        // Get part
        const partRows = await db
            .select()
            .from(parts)
            .where(eq(parts.id, id))
            .limit(1);

        if (partRows.length === 0) {
            return null;
        }

        const part = partRows[0];

        // Get identifiers
        const identifierRows = await db
            .select()
            .from(partIdentifiers)
            .where(eq(partIdentifiers.partId, id));

        // Get dimensions
        const dimensionRows = await db
            .select()
            .from(partDimensions)
            .where(eq(partDimensions.partId, id))
            .limit(1);

        const aggregateData: PartAggregateData = {
            part,
            identifiers: identifierRows,
            dimensions: dimensionRows[0] || null,
        };

        return toDomainPart(aggregateData);
    }

    async findByOemPartNumber(
        partNumber: string,
        manufacturer?: string,
        pagination?: PaginationParams
    ): Promise<Part[] | PaginatedResult<Part>> {
        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        // Find part IDs by identifier
        let identifierQuery = db
            .select({ partId: partIdentifiers.partId })
            .from(partIdentifiers)
            .where(
                and(
                    eq(partIdentifiers.type, 'OEM'),
                    eq(partIdentifiers.value, partNumber),
                    manufacturer ? eq(partIdentifiers.manufacturer, manufacturer) : undefined
                )
            );

        if (pagination) {
            identifierQuery = identifierQuery.limit(limit + 1).offset(offset);
        }

        const identifierRows = await identifierQuery;
        const hasMore = pagination && identifierRows.length > limit;
        const pageIdentifiers = hasMore ? identifierRows.slice(0, limit) : identifierRows;
        const partIds = pageIdentifiers.map((row) => row.partId);

        if (partIds.length === 0) {
            const items: Part[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        // Fetch parts with identifiers and dimensions
        const partsData = await this.fetchPartsWithRelations(partIds);

        if (!pagination) return partsData;
        return createPaginatedResult(partsData, pagination, hasMore);
    }

    async findByAftermarketPartNumber(
        partNumber: string,
        manufacturer?: string,
        pagination?: PaginationParams
    ): Promise<Part[] | PaginatedResult<Part>> {
        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        // Find part IDs by identifier
        let identifierQuery = db
            .select({ partId: partIdentifiers.partId })
            .from(partIdentifiers)
            .where(
                and(
                    eq(partIdentifiers.type, 'AFTERMARKET'),
                    eq(partIdentifiers.value, partNumber),
                    manufacturer ? eq(partIdentifiers.manufacturer, manufacturer) : undefined
                )
            );

        if (pagination) {
            identifierQuery = identifierQuery.limit(limit + 1).offset(offset);
        }

        const identifierRows = await identifierQuery;
        const hasMore = pagination && identifierRows.length > limit;
        const pageIdentifiers = hasMore ? identifierRows.slice(0, limit) : identifierRows;
        const partIds = pageIdentifiers.map((row) => row.partId);

        if (partIds.length === 0) {
            const items: Part[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        // Fetch parts with identifiers and dimensions
        const partsData = await this.fetchPartsWithRelations(partIds);

        if (!pagination) return partsData;
        return createPaginatedResult(partsData, pagination, hasMore);
    }

    async findByInterchangeCode(
        system: InterchangeSystem,
        code: string,
        pagination?: PaginationParams
    ): Promise<Part[] | PaginatedResult<Part>> {
        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        // Find interchange by system and code
        const interchangeRows = await db
            .select()
            .from(interchanges)
            .where(and(eq(interchanges.system, system), eq(interchanges.code, code)))
            .limit(1);

        if (interchangeRows.length === 0) {
            const items: Part[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        const interchangeId = interchangeRows[0].id;

        // Find part IDs through interchange memberships
        let membershipQuery = db
            .select({ partId: interchangeMemberships.partId })
            .from(interchangeMemberships)
            .where(eq(interchangeMemberships.interchangeId, interchangeId));

        if (pagination) {
            membershipQuery = membershipQuery.limit(limit + 1).offset(offset);
        }

        const membershipRows = await membershipQuery;
        const hasMore = pagination && membershipRows.length > limit;
        const pageMemberships = hasMore ? membershipRows.slice(0, limit) : membershipRows;
        const partIds = pageMemberships.map((row) => row.partId);

        if (partIds.length === 0) {
            const items: Part[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        // Fetch parts with identifiers and dimensions
        const partsData = await this.fetchPartsWithRelations(partIds);

        if (!pagination) return partsData;
        return createPaginatedResult(partsData, pagination, hasMore);
    }

    async findByFitment(
        fitment: Fitment,
        category?: PartCategory,
        pagination?: PaginationParams
    ): Promise<Part[] | PaginatedResult<Part>> {
        // Use cursor-based pagination for fitment queries (can match thousands)
        const limit = normalizeLimit(pagination?.limit);
        let cursorPartId: string | undefined;

        if (pagination?.cursor) {
            const cursor = decodeCursor(pagination.cursor) as { partId?: string };
            cursorPartId = cursor.partId;
        }

        // Find fitment IDs matching criteria
        const fitmentQuery = db
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
            const items: Part[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false, null);
        }

        // Find part IDs through partFitments
        let partFitmentQuery = db
            .select({ partId: partFitments.partId })
            .from(partFitments)
            .where(partFitments.fitmentId.in(fitmentIds));

        if (cursorPartId) {
            partFitmentQuery = partFitmentQuery.where(
                and(sql`${partFitments.partId} > ${cursorPartId}`)
            );
        }

        partFitmentQuery = partFitmentQuery.groupBy(partFitments.partId).limit(limit + 1);

        const partFitmentRows = await partFitmentQuery;
        const hasMore = partFitmentRows.length > limit;
        const pagePartFitments = hasMore ? partFitmentRows.slice(0, limit) : partFitmentRows;
        const partIds = pagePartFitments.map((row) => row.partId);

        if (partIds.length === 0) {
            const items: Part[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false, null);
        }

        // Filter by category if provided
        let filteredPartIds = partIds;
        if (category) {
            const categoryRows = await db
                .select({ id: parts.id })
                .from(parts)
                .where(and(parts.id.in(partIds), eq(parts.category, category)));
            filteredPartIds = categoryRows.map((row) => row.id);
        }

        if (filteredPartIds.length === 0) {
            const items: Part[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false, null);
        }

        // Fetch parts with identifiers and dimensions
        const partsData = await this.fetchPartsWithRelations(filteredPartIds);

        const nextCursor = hasMore && pagePartFitments.length > 0
            ? encodeCursor({ partId: pagePartFitments[pagePartFitments.length - 1].partId })
            : null;

        if (!pagination) return partsData;
        return createPaginatedResult(partsData, pagination, hasMore, nextCursor);
    }

    async upsert(
        part: Omit<Part, 'createdAt' | 'updatedAt'> & { id?: string }
    ): Promise<Part> {
        return await db.transaction(async (tx) => {
            // Upsert part
            const [inserted] = await tx
                .insert(parts)
                .values(toDbPartInsert(part))
                .onConflictDoUpdate({
                    target: parts.id,
                    set: {
                        name: part.name,
                        category: part.category,
                        position: part.position ?? null,
                        description: part.description ?? null,
                        weightGrams: part.weightGrams ?? null,
                        isDiscontinued: part.isDiscontinued ?? false,
                        updatedAt: new Date(),
                    },
                })
                .returning();

            const partId = inserted.id;

            // Upsert identifiers (delete existing and insert new for simplicity)
            // In production, you might want to do a smarter merge
            await tx.delete(partIdentifiers).where(eq(partIdentifiers.partId, partId));

            if (part.partIdentifiers.length > 0) {
                await tx.insert(partIdentifiers).values(
                    part.partIdentifiers.map((identifier) => ({
                        partId,
                        type: identifier.type,
                        value: identifier.value,
                        manufacturer: identifier.manufacturer,
                        certification: identifier.certification ?? null,
                    }))
                );
            }

            // Fetch with relations
            const partsData = await this.fetchPartsWithRelations([partId]);
            return partsData[0];
        });
    }

    async addIdentifier(
        partId: string,
        identifier: Omit<PartIdentifier, 'createdAt'>
    ): Promise<void> {
        await db
            .insert(partIdentifiers)
            .values({
                partId,
                type: identifier.type,
                value: identifier.value,
                manufacturer: identifier.manufacturer,
                certification: identifier.certification ?? null,
            })
            .onConflictDoNothing();
    }

    async setDimensions(partId: string, dimensions: Dimensions): Promise<void> {
        await db
            .insert(partDimensions)
            .values({
                partId,
                lengthMM: dimensions.lengthMM,
                widthMM: dimensions.widthMM,
                heightMM: dimensions.heightMM,
            })
            .onConflictDoUpdate({
                target: partDimensions.partId,
                set: {
                    lengthMM: dimensions.lengthMM,
                    widthMM: dimensions.widthMM,
                    heightMM: dimensions.heightMM,
                },
            });
    }

    /**
     * Helper method to fetch parts with their identifiers and dimensions
     */
    private async fetchPartsWithRelations(partIds: string[]): Promise<Part[]> {
        if (partIds.length === 0) {
            return [];
        }

        // Fetch parts
        const partRows = await db
            .select()
            .from(parts)
            .where(parts.id.in(partIds));

        // Fetch identifiers
        const identifierRows = await db
            .select()
            .from(partIdentifiers)
            .where(partIdentifiers.partId.in(partIds));

        // Fetch dimensions
        const dimensionRows = await db
            .select()
            .from(partDimensions)
            .where(partDimensions.partId.in(partIds));

        // Group identifiers and dimensions by partId
        const identifiersByPart = new Map<string, typeof partIdentifiers.$inferSelect[]>();
        for (const identifier of identifierRows) {
            const identifiers = identifiersByPart.get(identifier.partId) || [];
            identifiers.push(identifier);
            identifiersByPart.set(identifier.partId, identifiers);
        }

        const dimensionsByPart = new Map<string, typeof partDimensions.$inferSelect>();
        for (const dimension of dimensionRows) {
            dimensionsByPart.set(dimension.partId, dimension);
        }

        // Build aggregate data and convert to domain
        return partRows.map((part) => {
            const aggregateData: PartAggregateData = {
                part,
                identifiers: identifiersByPart.get(part.id) || [],
                dimensions: dimensionsByPart.get(part.id) || null,
            };
            return toDomainPart(aggregateData);
        });
    }
}
