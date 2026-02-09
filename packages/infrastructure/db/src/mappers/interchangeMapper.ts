import type { Interchange } from '@domain/interchange/interchange';
import type { interchanges } from '../schema';

type InterchangeRow = typeof interchanges.$inferSelect;
type InterchangeInsert = typeof interchanges.$inferInsert;

/**
 * Convert database row to domain Interchange
 */
export function toDomainInterchange(row: InterchangeRow): Interchange {
    return {
        system: row.system,
        code: row.code,
        createdAt: row.createdAt,
    };
}

/**
 * Convert domain Interchange to database insert format
 */
export function toDbInterchangeInsert(
    interchange: Omit<Interchange, 'createdAt'>
): InterchangeInsert {
    return {
        system: interchange.system,
        code: interchange.code,
    };
}
