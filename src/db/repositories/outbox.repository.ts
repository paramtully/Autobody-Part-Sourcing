import { asc, and, isNull, lt, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { outboxEvents } from '../models';

export type OutboxEventRow = typeof outboxEvents.$inferSelect;
export type OutboxEventInsert = typeof outboxEvents.$inferInsert;

export type CreateOutboxEventInput = Pick<
  OutboxEventInsert,
  'topic' | 'aggregateId' | 'payload'
>;

// Events with retryCount >= this threshold are treated as permanently failed
// and excluded from findUnpublished. Must match OutboxPublisher.maxRetries.
const OUTBOX_MAX_RETRIES = 5;

export class OutboxRepo {
  constructor(private readonly db: Db) {}

  async create(input: CreateOutboxEventInput): Promise<OutboxEventRow> {
    const [row] = await this.db.insert(outboxEvents).values(input).returning();
    return row;
  }

  /**
   * Fetch unpublished events that still have retries remaining,
   * ordered oldest-first for FIFO delivery.
   */
  async findUnpublished(limit: number): Promise<OutboxEventRow[]> {
    return this.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          isNull(outboxEvents.publishedAt),
          lt(outboxEvents.retryCount, OUTBOX_MAX_RETRIES),
        ),
      )
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit);
  }

  async markPublished(id: string): Promise<void> {
    await this.db
      .update(outboxEvents)
      .set({ publishedAt: new Date() })
      .where(eq(outboxEvents.id, id));
  }

  async incrementRetryCount(id: string): Promise<void> {
    await this.db
      .update(outboxEvents)
      .set({ retryCount: sql`${outboxEvents.retryCount} + 1` })
      .where(eq(outboxEvents.id, id));
  }
}
