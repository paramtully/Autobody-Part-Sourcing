import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { payments } from '../models';

export type PaymentRow = typeof payments.$inferSelect;
export type PaymentInsert = typeof payments.$inferInsert;

export class PaymentRepo {
  constructor(private readonly db: Db) {}

  async create(input: Omit<PaymentInsert, 'id' | 'createdAt' | 'updatedAt'>): Promise<PaymentRow> {
    const [row] = await this.db.insert(payments).values(input).returning();
    return row;
  }

  async findByOrderId(orderId: string): Promise<PaymentRow | null> {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId));
    return row ?? null;
  }

  async findByProviderPaymentId(providerPaymentId: string): Promise<PaymentRow | null> {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.providerPaymentId, providerPaymentId));
    return row ?? null;
  }

  async updateStatus(
    id: string,
    status: PaymentRow['status'],
    opts: { authorizedAt?: Date; capturedAt?: Date; cancelledAt?: Date; failureReason?: string } = {},
  ): Promise<PaymentRow> {
    const [row] = await this.db
      .update(payments)
      .set({ status, ...opts, updatedAt: new Date() })
      .where(eq(payments.id, id))
      .returning();
    return row;
  }
}
