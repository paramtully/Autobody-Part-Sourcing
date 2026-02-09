import { db } from '../db';
import { interchangeMemberships, interchanges } from '../schema';
import { eq, and } from 'drizzle-orm';
import type { InterchangeMembershipRepository } from '@interfaces/repositories/interchangeMembershipRepository';
import type InterchangeMembership from '@domain/interchange/interchangeMembership';
import type { PaginationParams, PaginatedResult } from '@interfaces/repositories/pagination';
import {
    toDomainInterchangeMembership,
    toDbInterchangeMembershipInsert,
} from '../mappers';
import { normalizeLimit, createPaginatedResult } from './paginationHelper';

export class InterchangeMembershipRepositoryImpl implements InterchangeMembershipRepository {
    async findById(id: string): Promise<InterchangeMembership | null> {
        // Parse composite ID: format is "partId-interchangeId"
        const [partId, interchangeId] = id.split('-');
        if (!partId || !interchangeId) {
            return null;
        }

        const rows = await db
            .select()
            .from(interchangeMemberships)
            .where(
                and(
                    eq(interchangeMemberships.partId, partId),
                    eq(interchangeMemberships.interchangeId, interchangeId)
                )
            )
            .limit(1);

        if (rows.length === 0) {
            return null;
        }

        return toDomainInterchangeMembership(rows[0]);
    }

    async findByPart(
        partId: string,
        pagination?: PaginationParams
    ): Promise<InterchangeMembership[] | PaginatedResult<InterchangeMembership>> {
        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        const rows = await db
            .select({
                membership: interchangeMemberships,
            })
            .from(interchangeMemberships)
            .where(eq(interchangeMemberships.partId, partId))
            .limit(limit + 1)
            .offset(offset);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;

        const items: InterchangeMembership[] = pageRows.map((row) =>
            toDomainInterchangeMembership(row.membership)
        );

        if (!pagination) return items;
        return createPaginatedResult(items, pagination, hasMore);
    }

    async findByInterchange(
        interchangeId: string,
        pagination?: PaginationParams
    ): Promise<InterchangeMembership[] | PaginatedResult<InterchangeMembership>> {
        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        const rows = await db
            .select({
                membership: interchangeMemberships,
            })
            .from(interchangeMemberships)
            .where(eq(interchangeMemberships.interchangeId, interchangeId))
            .limit(limit + 1)
            .offset(offset);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;

        const items: InterchangeMembership[] = pageRows.map((row) =>
            toDomainInterchangeMembership(row.membership)
        );

        if (!pagination) return items;
        return createPaginatedResult(items, pagination, hasMore);
    }

    async upsert(
        membership: Omit<InterchangeMembership, 'createdAt'> & { id?: string }
    ): Promise<InterchangeMembership> {
        const [inserted] = await db
            .insert(interchangeMemberships)
            .values(toDbInterchangeMembershipInsert(membership))
            .onConflictDoUpdate({
                target: [
                    interchangeMemberships.partId,
                    interchangeMemberships.interchangeId,
                ],
                set: {
                    confidence: membership.confidence ?? null,
                    source: membership.source ?? null,
                },
            })
            .returning();

        return toDomainInterchangeMembership(inserted);
    }
}
