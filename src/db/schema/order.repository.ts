import { eq, and, lt, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import type { Db } from '../client';
import { orders, orderStatusHistory, checkoutQuotes, feeConfigurations } from '../models';

// ── Types ────────────────────────────────────────────────────────

export type OrderRow = typeof orders.$inferSelect;
export type OrderInsert = typeof orders.$inferInsert;
export type QuoteRow = typeof checkoutQuotes.$inferSelect;
export type QuoteInsert = typeof checkoutQuotes.$inferInsert;

// ── Order Repository ──────────────────────────────────────────────

export class OrderRepo {
  constructor(private readonly db: Db) {}

  async create(input: Omit<OrderInsert, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'>): Promise<OrderRow> {
    const [{ nextval }] = await this.db.execute(
      sql`SELECT nextval('order_number_seq') as nextval`,
    ) as unknown as [{ nextval: string }];
    const orderNumber = `ORD-${new Date().getFullYear()}-${nextval}`;
    const orderLookupToken = randomBytes(32).toString('hex');

    const [row] = await this.db
      .insert(orders)
      .values({ ...input, orderNumber, orderLookupToken })
      .returning();

    return row;
  }

  async findById(id: string): Promise<OrderRow | null> {
    const [row] = await this.db.select().from(orders).where(eq(orders.id, id));
    return row ?? null;
  }

  async findByLookupToken(token: string): Promise<OrderRow | null> {
    const [row] = await this.db.select().from(orders).where(eq(orders.orderLookupToken, token));
    return row ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<OrderRow | null> {
    const [row] = await this.db.select().from(orders).where(eq(orders.idempotencyKey, key));
    return row ?? null;
  }

  /** Optimistic concurrency update — only succeeds if current status matches expected. */
  async updateStatus(
    orderId: string,
    expectedStatus: OrderRow['status'],
    newStatus: OrderRow['status'],
    opts: { reason?: string; actor?: string } = {},
  ): Promise<OrderRow | null> {
    const rows = await this.db
      .update(orders)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, expectedStatus)))
      .returning();

    if (rows.length === 0) return null;

    // Write status history
    await this.db.insert(orderStatusHistory).values({
      orderId,
      fromStatus: expectedStatus,
      toStatus: newStatus,
      reason: opts.reason,
      actor: opts.actor ?? 'system',
    });

    return rows[0];
  }

  async updateVendorOrder(
    orderId: string,
    fields: {
      vendorOrderId?: string;
      vendorOrderPlacedAt?: Date;
      vendorOrderConfirmedAt?: Date;
    },
  ): Promise<OrderRow> {
    const [row] = await this.db
      .update(orders)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();
    return row;
  }

  /** Find orders stuck in a given status longer than a threshold (for monitoring). */
  async findStuck(status: OrderRow['status'], olderThanMs: number): Promise<OrderRow[]> {
    const cutoff = new Date(Date.now() - olderThanMs);
    return this.db
      .select()
      .from(orders)
      .where(and(eq(orders.status, status), lt(orders.updatedAt, cutoff)));
  }
}

// ── Quote Repository ──────────────────────────────────────────────

export class QuoteRepo {
  constructor(private readonly db: Db) {}

  async create(input: Omit<QuoteInsert, 'id' | 'createdAt'>): Promise<QuoteRow> {
    const [row] = await this.db.insert(checkoutQuotes).values(input).returning();
    return row;
  }

  async findById(id: string): Promise<QuoteRow | null> {
    const [row] = await this.db.select().from(checkoutQuotes).where(eq(checkoutQuotes.id, id));
    return row ?? null;
  }

  async markUsed(id: string): Promise<void> {
    await this.db
      .update(checkoutQuotes)
      .set({ usedAt: new Date() })
      .where(eq(checkoutQuotes.id, id));
  }
}

// ── Fee Config Repository ─────────────────────────────────────────

export class FeeConfigRepo {
  constructor(private readonly db: Db) {}

  /** Returns the current active fee percent (latest effectiveFrom where effectiveUntil IS NULL). */
  async getCurrentFeePercent(): Promise<number> {
    const [row] = await this.db
      .select({ feePercent: feeConfigurations.feePercent })
      .from(feeConfigurations)
      .where(sql`${feeConfigurations.effectiveUntil} IS NULL`)
      .orderBy(sql`${feeConfigurations.effectiveFrom} DESC`)
      .limit(1);

    if (!row) throw new Error('No active fee configuration found');
    return Number(row.feePercent);
  }
}
