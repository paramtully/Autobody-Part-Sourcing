import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { outboxEvents } from '../models';

export type OutboxEventRow = typeof outboxEvents.$inferSelect;
export type OutboxEventInsert = typeof outboxEvents.$inferInsert;

export type CreateOutboxEventInput = Pick<
  OutboxEventInsert,
  'topic' | 'aggregateType' | 'aggregateId' | 'payload'
>;

export class OutboxRepo {
  constructor(private readonly db: Db) {}

  async create(input: CreateOutboxEventInput): Promise<OutboxEventRow> {
    const [row] = await this.db.insert(outboxEvents).values(input).returning();
    return row;
  }

  async findUnpublished(limit: number): Promise<OutboxEventRow[]> {
    return this.db
      .select()
      .from(outboxEvents)
      .where(sql`${outboxEvents.publishedAt} IS NULL AND ${outboxEvents.failedAt} IS NULL`)
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit);
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
}
