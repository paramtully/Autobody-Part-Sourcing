import { eq, and, lt, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import type { OrderRepository, CreateOrderInput } from '@interfaces/repositories/orderRepository';
import type { Order } from '@domain/order/order';
import type { OrderStatus } from '@domain/order/orderStatus';
import { orders } from '../schema/orders';
import { toDomainOrder, type OrderRow } from '../mappers/orderMapper';
import type { db as DbType } from '../db';

type Db = typeof DbType;

export class OrderRepositoryImpl implements OrderRepository {
    constructor(private readonly db: Db) {}

    async create(input: CreateOrderInput): Promise<Order> {
        // Generate order number from Postgres sequence
        const [{ nextval }] = await this.db.execute(
            sql`SELECT nextval('order_number_seq') as nextval`,
        ) as unknown as [{ nextval: string }];
        const year = new Date().getFullYear();
        const orderNumber = `ORD-${year}-${nextval}`;

        const [row] = await this.db
            .insert(orders)
            .values({
                orderNumber,
                status: input.status,
                userId: input.userId,
                contactEmail: input.contactEmail,
                contactPhone: input.contactPhone,
                orderLookupToken: input.orderLookupToken,
                idempotencyKey: input.idempotencyKey,
                quoteId: input.quoteId,
                listingId: input.listingId,
                vendorId: input.vendorId,
                shippingAddress: input.shippingAddress,
                snapshotPartName: input.snapshot.partName,
                snapshotPartNumber: input.snapshot.partNumber,
                snapshotCondition: input.snapshot.condition,
                snapshotVendorName: input.snapshot.vendorName,
                snapshotListingPriceMinor: input.snapshot.listingPriceMinor,
                snapshotCurrency: input.snapshot.currency,
                partPriceMinor: input.pricing.partPriceMinor,
                serviceFeeMinor: input.pricing.serviceFeeMinor,
                feePercentApplied: input.pricing.feePercentApplied.toString(),
                shippingMinor: input.pricing.shippingMinor,
                taxMinor: input.pricing.taxMinor,
                totalMinor: input.pricing.totalMinor,
                currency: input.pricing.currency,
                totalRefundedMinor: input.totalRefundedMinor,
                vendorOrderId: input.vendorOrderId,
                vendorOrderingMode: input.vendorOrderingMode,
                vendorOrderPlacedAt: input.vendorOrderPlacedAt,
                vendorOrderConfirmedAt: input.vendorOrderConfirmedAt,
            })
            .returning();

        return toDomainOrder(row as unknown as OrderRow);
    }

    async findById(id: string): Promise<Order | null> {
        const [row] = await this.db.select().from(orders).where(eq(orders.id, id));
        return row ? toDomainOrder(row as unknown as OrderRow) : null;
    }

    async findByLookupToken(token: string): Promise<Order | null> {
        const [row] = await this.db
            .select()
            .from(orders)
            .where(eq(orders.orderLookupToken, token));
        return row ? toDomainOrder(row as unknown as OrderRow) : null;
    }

    async findByIdempotencyKey(key: string): Promise<Order | null> {
        const [row] = await this.db
            .select()
            .from(orders)
            .where(eq(orders.idempotencyKey, key));
        return row ? toDomainOrder(row as unknown as OrderRow) : null;
    }

    async updateStatus(
        orderId: string,
        expectedStatus: OrderStatus,
        newStatus: OrderStatus,
    ): Promise<Order | null> {
        const rows = await this.db
            .update(orders)
            .set({ status: newStatus })
            .where(and(eq(orders.id, orderId), eq(orders.status, expectedStatus)))
            .returning();

        if (rows.length === 0) return null;
        return toDomainOrder(rows[0] as unknown as OrderRow);
    }

    async update(
        orderId: string,
        fields: Partial<Pick<Order, 'vendorOrderId' | 'vendorOrderPlacedAt' | 'vendorOrderConfirmedAt' | 'totalRefundedMinor'>>,
    ): Promise<Order> {
        const setClause: Record<string, unknown> = {};
        if (fields.vendorOrderId !== undefined) setClause.vendorOrderId = fields.vendorOrderId;
        if (fields.vendorOrderPlacedAt !== undefined) setClause.vendorOrderPlacedAt = fields.vendorOrderPlacedAt;
        if (fields.vendorOrderConfirmedAt !== undefined) setClause.vendorOrderConfirmedAt = fields.vendorOrderConfirmedAt;
        if (fields.totalRefundedMinor !== undefined) setClause.totalRefundedMinor = fields.totalRefundedMinor;

        const [row] = await this.db
            .update(orders)
            .set(setClause)
            .where(eq(orders.id, orderId))
            .returning();

        return toDomainOrder(row as unknown as OrderRow);
    }

    async findStuckOrders(status: OrderStatus, olderThanMs: number): Promise<Order[]> {
        const cutoff = new Date(Date.now() - olderThanMs);
        const rows = await this.db
            .select()
            .from(orders)
            .where(and(eq(orders.status, status), lt(orders.updatedAt, cutoff)));

        return rows.map((r) => toDomainOrder(r as unknown as OrderRow));
    }
}
