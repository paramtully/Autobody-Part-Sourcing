import { db } from '../db';
import { interchanges, interchangeMemberships, parts } from '../schema';
import { eq, and, sql } from 'drizzle-orm';
import type { InterchangeRepository } from '@interfaces/repositories/interchangeRepository';
import type { Interchange } from '@domain/interchange/interchange';
import type Part from '@domain/part/part';
import { InterchangeSystem } from '@domain/interchange/interchange';
import type { PaginationParams, PaginatedResult } from '@interfaces/repositories/pagination';
import { toDomainInterchange, toDbInterchangeInsert } from '../mappers';
import { normalizeLimit, createPaginatedResult } from './paginationHelper';

export class InterchangeRepositoryImpl implements InterchangeRepository {
    async findById(id: string): Promise<Interchange | null> {
        const rows = await db
            .select()
            .from(interchanges)
            .where(eq(interchanges.id, id))
            .limit(1);

        if (rows.length === 0) {
            return null;
        }

        return toDomainInterchange(rows[0]);
    }

    async findByCode(system: InterchangeSystem, code: string): Promise<Interchange | null> {
        const rows = await db
            .select()
            .from(interchanges)
            .where(and(eq(interchanges.system, system), eq(interchanges.code, code)))
            .limit(1);

        if (rows.length === 0) {
            return null;
        }

        return toDomainInterchange(rows[0]);
    }

    async findInterchangeableParts(
        partId: string,
        pagination?: PaginationParams
    ): Promise<Part[] | PaginatedResult<Part>> {
        // Find interchange IDs for this part
        const memberships = await db
            .select({ interchangeId: interchangeMemberships.interchangeId })
            .from(interchangeMemberships)
            .where(eq(interchangeMemberships.partId, partId));

        if (memberships.length === 0) {
            const items: Part[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        const interchangeIds = memberships.map((m) => m.interchangeId);

        // Find all parts in the same interchange groups (excluding the original part)
        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        const partMemberships = await db
            .select({
                partId: interchangeMemberships.partId,
            })
            .from(interchangeMemberships)
            .where(
                and(
                    interchangeMemberships.interchangeId.in(interchangeIds),
                    sql`${interchangeMemberships.partId} != ${partId}`
                )
            )
            .limit(limit + 1)
            .offset(offset);

        const hasMore = partMemberships.length > limit;
        const pageMemberships = hasMore ? partMemberships.slice(0, limit) : partMemberships;
        const partIds = pageMemberships.map((m) => m.partId);

        if (partIds.length === 0) {
            const items: Part[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        // Fetch parts (simplified - full implementation would use PartRepository to get with identifiers)
        const items: Part[] = partRows.map((part) => ({
            name: part.name,
            category: part.category as any,
            position: (part.position as any) ?? undefined,
            description: part.description ?? undefined,
            weightGrams: part.weightGrams ?? undefined,
            dimensions: undefined,
            partIdentifiers: [],
            isDiscontinued: part.isDiscontinued ?? undefined,
            createdAt: part.createdAt,
            updatedAt: part.updatedAt,
        }));

        if (!pagination) return items;
        return createPaginatedResult(items, pagination, hasMore);
    }

    async findByPart(
        partId: string,
        pagination?: PaginationParams
    ): Promise<Interchange[] | PaginatedResult<Interchange>> {
        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        const rows = await db
            .select({
                interchange: interchanges,
            })
            .from(interchangeMemberships)
            .innerJoin(interchanges, eq(interchangeMemberships.interchangeId, interchanges.id))
            .where(eq(interchangeMemberships.partId, partId))
            .limit(limit + 1)
            .offset(offset);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;

        const items: Interchange[] = pageRows.map((row) => toDomainInterchange(row.interchange));

        if (!pagination) return items;
        return createPaginatedResult(items, pagination, hasMore);
    }

    async findPartsByInterchangeGroup(
        interchangeId: string,
        pagination?: PaginationParams
    ): Promise<Part[] | PaginatedResult<Part>> {
        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        const memberships = await db
            .select({
                partId: interchangeMemberships.partId,
            })
            .from(interchangeMemberships)
            .where(eq(interchangeMemberships.interchangeId, interchangeId))
            .limit(limit + 1)
            .offset(offset);

        const hasMore = memberships.length > limit;
        const pageMemberships = hasMore ? memberships.slice(0, limit) : memberships;
        const partIds = pageMemberships.map((m) => m.partId);

        if (partIds.length === 0) {
            const items: Part[] = [];
            if (!pagination) return items;
            return createPaginatedResult(items, pagination, false);
        }

        // Fetch parts (simplified - full implementation would join identifiers and dimensions)
        const partRows = await db
            .select()
            .from(parts)
            .where(parts.id.in(partIds));

        const items: Part[] = partRows.map((part) => ({
            name: part.name,
            category: part.category as any,
            position: (part.position as any) ?? undefined,
            description: part.description ?? undefined,
            weightGrams: part.weightGrams ?? undefined,
            dimensions: undefined,
            partIdentifiers: [],
            isDiscontinued: part.isDiscontinued ?? undefined,
            createdAt: part.createdAt,
            updatedAt: part.updatedAt,
        }));

        if (!pagination) return items;
        return createPaginatedResult(items, pagination, hasMore);
    }

    async upsert(interchange: Omit<Interchange, 'createdAt'> & { id?: string }): Promise<Interchange> {
        const [inserted] = await db
            .insert(interchanges)
            .values(toDbInterchangeInsert(interchange))
            .onConflictDoUpdate({
                target: [interchanges.system, interchanges.code],
                set: {
                    system: interchange.system,
                    code: interchange.code,
                },
            })
            .returning();

        return toDomainInterchange(inserted);
    }
}
