import type { Order } from '@domain/order/order';
import { OrderStatus, assertTransitionAllowed, StaleOrderError } from '@domain/order/orderStatus';
import type { OrderRepository } from '@interfaces/repositories/orderRepository';
import type { OutboxRepository, CreateOutboxEventInput } from '@interfaces/repositories/outboxRepository';
import type { DistributedLockService } from '@interfaces/services/distributedLockService';

/**
 * Core order state machine enforcement.
 * All status transitions go through this service to guarantee:
 * 1. Transition is allowed per ALLOWED_TRANSITIONS
 * 2. Optimistic concurrency (WHERE status = expected)
 * 3. Distributed lock prevents concurrent conflicting transitions
 * 4. History row + outbox event written with every transition
 */
export class OrderService {
    constructor(
        private readonly orderRepo: OrderRepository,
        private readonly outboxRepo: OutboxRepository,
        private readonly lockService: DistributedLockService,
    ) {}

    async findById(id: string): Promise<Order | null> {
        return this.orderRepo.findById(id);
    }

    async findByLookupToken(token: string): Promise<Order | null> {
        return this.orderRepo.findByLookupToken(token);
    }

    async findByIdempotencyKey(key: string): Promise<Order | null> {
        return this.orderRepo.findByIdempotencyKey(key);
    }

    /**
     * Transition an order to a new status with distributed locking,
     * state machine enforcement, and optimistic concurrency.
     */
    async transition(
        orderId: string,
        expectedStatus: OrderStatus,
        newStatus: OrderStatus,
        opts: { reason?: string; actor?: string } = {},
    ): Promise<Order> {
        const { reason, actor = 'system' } = opts;

        // 1. Validate transition is legal
        assertTransitionAllowed(expectedStatus, newStatus);

        // 2. Acquire distributed lock
        const lock = await this.lockService.acquireLock(
            `lock:order:${orderId}:transition`,
            10_000,
        );

        try {
            // 3. Optimistic concurrency update
            const updated = await this.orderRepo.updateStatus(orderId, expectedStatus, newStatus);
            if (!updated) {
                throw new StaleOrderError(orderId, expectedStatus);
            }

            // 4. Write outbox event
            await this.outboxRepo.create({
                topic: 'order.status_changed',
                aggregateType: 'order',
                aggregateId: orderId,
                payload: {
                    orderId,
                    fromStatus: expectedStatus,
                    toStatus: newStatus,
                    reason,
                    actor,
                    timestamp: new Date().toISOString(),
                },
            });

            return updated;
        } finally {
            await this.lockService.releaseLock(lock);
        }
    }
}
