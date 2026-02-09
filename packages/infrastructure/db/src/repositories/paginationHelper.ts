import type { PaginationParams, PaginatedResult } from '@interfaces/repositories/pagination';

export interface CursorPayload {
    id?: string;
    createdAt?: string;
    [key: string]: unknown;
}

/**
 * Encode cursor payload to base64 string for pagination
 */
export function encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/**
 * Decode base64 cursor string to payload object
 */
export function decodeCursor(cursor: string): CursorPayload {
    try {
        return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    } catch (error) {
        throw new Error(`Invalid cursor format: ${cursor}`);
    }
}

/**
 * Normalize and validate pagination limit
 * @param requested - Requested limit
 * @param max - Maximum allowed limit (default: 500)
 * @param defaultLimit - Default limit if not provided (default: 50)
 */
export function normalizeLimit(
    requested?: number,
    max: number = 500,
    defaultLimit: number = 50
): number {
    if (!requested || requested <= 0) {
        return defaultLimit;
    }
    return Math.min(requested, max);
}

/**
 * Create paginated result from items
 */
export function createPaginatedResult<T>(
    items: T[],
    pagination: PaginationParams,
    hasMore: boolean,
    nextCursor?: string | null
): PaginatedResult<T> {
    return {
        items,
        pagination: {
            limit: pagination.limit,
            offset: pagination.offset,
            cursor: pagination.cursor,
            nextCursor: nextCursor ?? null,
            hasMore,
        },
    };
}
