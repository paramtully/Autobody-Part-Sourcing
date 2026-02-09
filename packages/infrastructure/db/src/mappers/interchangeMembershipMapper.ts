import type InterchangeMembership from '@domain/interchange/interchangeMembership';
import type { interchangeMemberships } from '../schema';

type InterchangeMembershipRow = typeof interchangeMemberships.$inferSelect;
type InterchangeMembershipInsert = typeof interchangeMemberships.$inferInsert;

/**
 * Convert database row to domain InterchangeMembership
 * Note: Database uses composite key (partId, interchangeId), but domain has id field
 * We generate a composite id string for the domain model
 */
export function toDomainInterchangeMembership(
    row: InterchangeMembershipRow
): InterchangeMembership {
    // Generate composite ID from partId and interchangeId
    const id = `${row.partId}-${row.interchangeId}`;
    
    return {
        id,
        interchangeId: row.interchangeId,
        partId: row.partId,
        confidence: row.confidence !== null ? Number(row.confidence) : undefined,
        source: row.source ?? undefined,
        createdAt: row.createdAt,
    };
}

/**
 * Convert domain InterchangeMembership to database insert format
 */
export function toDbInterchangeMembershipInsert(
    membership: Omit<InterchangeMembership, 'id' | 'createdAt'>
): InterchangeMembershipInsert {
    return {
        partId: membership.partId,
        interchangeId: membership.interchangeId,
        confidence: membership.confidence ?? null,
        source: membership.source ?? null,
    };
}
