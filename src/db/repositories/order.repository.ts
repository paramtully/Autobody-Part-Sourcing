import { eq, and, lt, or, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { Db, db } from '../client';
import { orders, checkoutQuotes } from '../models/index.js';

// ── Types ────────────────────────────────────────────────────────

export type OrderRow = typeof orders.$inferSelect;
export type OrderInsert = typeof orders.$inferInsert;
export type QuoteRow = typeof checkoutQuotes.$inferSelect;
export type QuoteInsert = typeof checkoutQuotes.$inferInsert;

/** Worker lease for vendor placement — stale claims may be overridden by another worker. */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

// ── Order Repository ──────────────────────────────────────────────

export class OrderRepo {
  private readonly db: Db;

  constructor(database: Db = db) {
    this.db = database;
  }

  async create(
    input: Omit<OrderInsert, 'id' | 'orderNumber' | 'orderLookupToken' | 'createdAt' | 'updatedAt'>,
  ): Promise<OrderRow> {
    const [{ nextval }] = (await this.db.execute(
      sql`SELECT nextval('order_number_seq') as nextval`,
    )) as unknown as [{ nextval: string }];
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
    const [row] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.orderLookupToken, token));
    return row ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<OrderRow | null> {
    const [row] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.idempotencyKey, key));
    return row ?? null;
  }

  /**
   * Atomically claims an order for vendor placement.
   * Wins if status is PAYMENT_AUTHORIZED, or VENDOR_ORDER_PLACING with a stale lease
   * (null claimedAt or older than CLAIM_LEASE_MS).
   */
  async claimForVendorPlacement(orderId: string): Promise<OrderRow | null> {
    const staleBefore = new Date(Date.now() - CLAIM_LEASE_MS);
    const [row] = await this.db
      .update(orders)
      .set({ status: 'VENDOR_ORDER_PLACING', claimedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, orderId),
          or(
            eq(orders.status, 'PAYMENT_AUTHORIZED'),
            and(
              eq(orders.status, 'VENDOR_ORDER_PLACING'),
              lt(orders.claimedAt, staleBefore),
            ),
          ),
        ),
      )
      .returning();

    return row ?? null;
  }

  /**
   * Optimistic concurrency update — only succeeds if current status matches
   * expectedStatus. Returns the updated row, or null if the status had already
   * changed (caller should treat as a no-op / retry).
   */
  async updateStatus(
    orderId: string,
    expectedStatus: OrderRow['status'],
    newStatus: OrderRow['status'],
  ): Promise<OrderRow | null> {
    const [row] = await this.db
      .update(orders)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, expectedStatus)))
      .returning();

    return row ?? null;
  }

  async updateVendorOrder(
    orderId: string,
    fields: { vendorOrderId?: string },
  ): Promise<OrderRow> {
    const [row] = await this.db
      .update(orders)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();
    return row;
  }

  /** Set the Stripe PaymentIntent id after creation. */
  async setStripePayment(orderId: string, providerPaymentId: string): Promise<void> {
    await this.db
      .update(orders)
      .set({ paymentProviderPaymentId: providerPaymentId, updatedAt: new Date() })
      .where(eq(orders.id, orderId));
  }

  /** Update the inline payment status on the order row. */
  async setPaymentStatus(
    orderId: string,
    status: OrderRow['paymentStatus'],
  ): Promise<void> {
    await this.db
      .update(orders)
      .set({ paymentStatus: status, updatedAt: new Date() })
      .where(eq(orders.id, orderId));
  }

  /** Update tax and total on the order row (set from provider's tax calculation at confirm). */
  async setTaxAndTotal(orderId: string, taxMinor: number, totalMinor: number): Promise<void> {
    await this.db
      .update(orders)
      .set({ taxMinor, totalMinor, updatedAt: new Date() })
      .where(eq(orders.id, orderId));
  }

  /** Increment total_refunded_minor after a successful refund. */
  async addRefundedAmount(orderId: string, amountMinor: number): Promise<void> {
    await this.db
      .update(orders)
      .set({
        totalRefundedMinor: sql`${orders.totalRefundedMinor} + ${amountMinor}`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));
  }

  async findByProviderPaymentId(providerPaymentId: string): Promise<OrderRow | null> {
    const [row] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.paymentProviderPaymentId, providerPaymentId));
    return row ?? null;
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
  private readonly db: Db;

  constructor(database: Db = db) {
    this.db = database;
  }

  async create(input: Omit<QuoteInsert, 'id' | 'createdAt'>): Promise<QuoteRow> {
    const [row] = await this.db.insert(checkoutQuotes).values(input).returning();
    return row;
  }

  async findById(id: string): Promise<QuoteRow | null> {
    const [row] = await this.db
      .select()
      .from(checkoutQuotes)
      .where(eq(checkoutQuotes.id, id));
    return row ?? null;
  }

  /** Delete quote on confirm — absence is the used signal. */
  async delete(id: string): Promise<void> {
    await this.db.delete(checkoutQuotes).where(eq(checkoutQuotes.id, id));
  }
}
