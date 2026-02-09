/**
 * Pagination parameters for list/search operations.
 * Supports both offset-based and cursor-based pagination.
 */
export interface PaginationParams {
    /**
     * Maximum number of items to return per page.
     * Required. Implementation should enforce maximum limit (typically 500).
     * Default: 50 if not specified.
     */
    limit: number;

    /**
     * Offset for offset-based pagination (number of items to skip).
     * Use either offset or cursor, not both.
     */
    offset?: number;

    /**
     * Cursor for cursor-based pagination (alternative to offset).
     * Use either offset or cursor, not both.
     * Cursor-based pagination is more performant for large datasets.
     */
    cursor?: string;
}

/**
 * Paginated result with metadata.
 * Returned when pagination parameters are provided to search/list methods.
 */
export interface PaginatedResult<T> {
    /**
     * Array of items for the current page.
     */
    items: T[];

    /**
     * Pagination metadata.
     */
    pagination: {
        /**
         * Limit used for this page.
         */
        limit: number;

        /**
         * Offset used for this page (if offset-based pagination).
         */
        offset?: number;

        /**
         * Cursor used for this page (if cursor-based pagination).
         */
        cursor?: string;

        /**
         * Cursor for the next page. null if no more pages available.
         */
        nextCursor?: string | null;

        /**
         * Whether there are more items available.
         */
        hasMore: boolean;

        /**
         * Total count of items (optional - expensive to compute).
         * Only included if explicitly requested.
         */
        totalCount?: number;
    };
}
