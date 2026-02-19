export interface OutboxEvent {
    id: string;
    topic: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    createdAt: Date;
    publishedAt: Date | null;
    failedAt: Date | null;
    retryCount: number;
}

export type CreateOutboxEventInput = Pick<OutboxEvent, 'topic' | 'aggregateType' | 'aggregateId' | 'payload'>;

export interface OutboxRepository {
    /**
     * Insert a new outbox event. Typically called inside the same DB transaction
     * as the state change it represents.
     */
    create(input: CreateOutboxEventInput): Promise<OutboxEvent>;

    /**
     * Fetch unpublished events ordered by creation time.
     */
    findUnpublished(limit: number): Promise<OutboxEvent[]>;

    /**
     * Mark an event as published.
     */
    markPublished(id: string): Promise<void>;

    /**
     * Mark an event as failed after max retries.
     */
    markFailed(id: string): Promise<void>;

    /**
     * Increment retry count.
     */
    incrementRetryCount(id: string): Promise<void>;
}
