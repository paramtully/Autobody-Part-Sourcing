import { eq, isNull, asc, sql } from 'drizzle-orm';
import type {
    OutboxRepository,
    OutboxEvent,
    CreateOutboxEventInput,
} from '@interfaces/repositories/outboxRepository';
import { outboxEvents } from '../schema/outboxEvents';
import type { db as DbType } from '../db';

type Db = typeof DbType;

export class OutboxRepositoryImpl implements OutboxRepository {
    constructor(private readonly db: Db) {}

    async create(input: CreateOutboxEventInput): Promise<OutboxEvent> {
        const [row] = await this.db
            .insert(outboxEvents)
            .values({
                topic: input.topic,
                aggregateType: input.aggregateType,
                aggregateId: input.aggregateId,
                payload: input.payload,
            })
            .returning();

        return this.toDomain(row);
    }

    async findUnpublished(limit: number): Promise<OutboxEvent[]> {
        const rows = await this.db
            .select()
            .from(outboxEvents)
            .where(isNull(outboxEvents.publishedAt))
            .orderBy(asc(outboxEvents.createdAt))
            .limit(limit);

        return rows.map((r) => this.toDomain(r));
    }

    async markPublished(id: string): Promise<void> {
        await this.db
            .update(outboxEvents)
            .set({ publishedAt: new Date() })
            .where(eq(outboxEvents.id, id));
    }

    async markFailed(id: string): Promise<void> {
        await this.db
            .update(outboxEvents)
            .set({ failedAt: new Date() })
            .where(eq(outboxEvents.id, id));
    }

    async incrementRetryCount(id: string): Promise<void> {
        await this.db
            .update(outboxEvents)
            .set({ retryCount: sql`${outboxEvents.retryCount} + 1` })
            .where(eq(outboxEvents.id, id));
    }

    private toDomain(row: typeof outboxEvents.$inferSelect): OutboxEvent {
        return {
            id: row.id,
            topic: row.topic,
            aggregateType: row.aggregateType,
            aggregateId: row.aggregateId,
            payload: row.payload as Record<string, unknown>,
            createdAt: row.createdAt,
            publishedAt: row.publishedAt,
            failedAt: row.failedAt,
            retryCount: row.retryCount,
        };
    }
}
