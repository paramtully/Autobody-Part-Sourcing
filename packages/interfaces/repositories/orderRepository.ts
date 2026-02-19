import type { Order } from '@domain/order/order';
import type { OrderStatus } from '@domain/order/orderStatus';

/**
 * Represents the fields to insert when creating an order.
 */
export type CreateOrderInput = Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt'>;

/**
 * Repository interface for Order persistence.
 */
export interface OrderRepository {
    /**
     * Insert a new order. Generates id, orderNumber, timestamps.
     * @throws on idempotencyKey or orderLookupToken conflict
     */
    create(input: CreateOrderInput): Promise<Order>;

    /**
     * Find an order by its primary key.
     */
    findById(id: string): Promise<Order | null>;

    /**
     * Find an order by its public lookup token (guest tracking).
     */
    findByLookupToken(token: string): Promise<Order | null>;

    /**
     * Find an order by its idempotency key (dedup at confirm).
     */
    findByIdempotencyKey(key: string): Promise<Order | null>;

    /**
     * Optimistic concurrency update: sets new status only if the order
     * is currently in `expectedStatus`. Returns the updated order.
     * @returns the updated order, or null if `rowsAffected === 0`
     */
    updateStatus(
        orderId: string,
        expectedStatus: OrderStatus,
        newStatus: OrderStatus,
    ): Promise<Order | null>;

    /**
     * Generic partial update for non-status fields (vendor_order_id, etc.).
     * Does NOT change status — use `updateStatus` for that.
     */
    update(orderId: string, fields: Partial<Pick<Order, 
        'vendorOrderId' | 'vendorOrderPlacedAt' | 'vendorOrderConfirmedAt' | 'totalRefundedMinor'
    >>): Promise<Order>;

    /**
     * Find orders stuck in a given status for longer than `olderThanMs`.
     * Used by the stuck-order detection worker.
     */
    findStuckOrders(status: OrderStatus, olderThanMs: number): Promise<Order[]>;
}
