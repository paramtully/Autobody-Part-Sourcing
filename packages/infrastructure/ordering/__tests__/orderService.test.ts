import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { OrderService } from '../orderService';
import { OrderStatus, InvalidTransitionError, StaleOrderError } from '@domain/order/orderStatus';
import type { Order } from '@domain/order/order';
import type { OrderRepository } from '@interfaces/repositories/orderRepository';
import type { OutboxRepository, CreateOutboxEventInput, OutboxEvent } from '@interfaces/repositories/outboxRepository';
import type { DistributedLockService, LockHandle } from '@interfaces/services/distributedLockService';

// ─── Helpers ─────────────────────────────────────────────────────

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
    id: 'order-1',
    orderNumber: 'ORD-100000',
    status: OrderStatus.DRAFT,
    userId: null,
    contactEmail: 'test@example.com',
    contactPhone: null,
    orderLookupToken: 'lookup-token-1',
    idempotencyKey: 'idem-key-1',
    quoteId: null,
    listingId: 'listing-1',
    vendorId: 'vendor-1',
    shippingAddress: { line1: '123 Main', city: 'Portland', state: 'OR', postalCode: '97201', country: 'US' },
    snapshot: {
        partName: 'Brake Pad',
        partNumber: 'BP-001',
        condition: 'NEW' as any,
        vendorName: 'TestVendor',
        listingPriceMinor: 5000,
        currency: 'USD' as any,
    },
    pricing: {
        partPriceMinor: 5000,
        serviceFeeMinor: 150,
        feePercentApplied: 0.03,
        shippingMinor: 500,
        taxMinor: 400,
        totalMinor: 6050,
        currency: 'USD' as any,
    },
    totalRefundedMinor: 0,
    vendorOrderId: null,
    vendorOrderingMode: 'API_SYNC' as any,
    vendorOrderPlacedAt: null,
    vendorOrderConfirmedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
});

const mockLockHandle: LockHandle = { key: 'test-lock', token: 'test-token' };

// ─── Mocks ───────────────────────────────────────────────────────

const createMockOrderRepo = (): jest.Mocked<OrderRepository> => ({
    create: jest.fn<OrderRepository['create']>(),
    findById: jest.fn<OrderRepository['findById']>(),
    findByLookupToken: jest.fn<OrderRepository['findByLookupToken']>(),
    findByIdempotencyKey: jest.fn<OrderRepository['findByIdempotencyKey']>(),
    updateStatus: jest.fn<OrderRepository['updateStatus']>(),
    update: jest.fn<OrderRepository['update']>(),
    findStuckOrders: jest.fn<OrderRepository['findStuckOrders']>(),
});

const createMockOutboxRepo = (): jest.Mocked<OutboxRepository> => ({
    create: jest.fn<OutboxRepository['create']>().mockResolvedValue({
        id: 'evt-1',
        topic: '',
        aggregateType: '',
        aggregateId: '',
        payload: {},
        createdAt: new Date(),
        publishedAt: null,
        failedAt: null,
        retryCount: 0,
    }),
    findUnpublished: jest.fn<OutboxRepository['findUnpublished']>(),
    markPublished: jest.fn<OutboxRepository['markPublished']>(),
    markFailed: jest.fn<OutboxRepository['markFailed']>(),
    incrementRetryCount: jest.fn<OutboxRepository['incrementRetryCount']>(),
});

const createMockLockService = (): jest.Mocked<DistributedLockService> => ({
    acquireLock: jest.fn<DistributedLockService['acquireLock']>().mockResolvedValue(mockLockHandle),
    releaseLock: jest.fn<DistributedLockService['releaseLock']>().mockResolvedValue(undefined),
});

// ─── Tests ───────────────────────────────────────────────────────

describe('OrderService', () => {
    let orderRepo: jest.Mocked<OrderRepository>;
    let outboxRepo: jest.Mocked<OutboxRepository>;
    let lockService: jest.Mocked<DistributedLockService>;
    let svc: OrderService;

    beforeEach(() => {
        orderRepo = createMockOrderRepo();
        outboxRepo = createMockOutboxRepo();
        lockService = createMockLockService();
        svc = new OrderService(orderRepo, outboxRepo, lockService);
    });

    // ── findById ──────────────────────────────────────────────────

    describe('findById', () => {
        it('should delegate to orderRepo', async () => {
            const order = makeOrder();
            orderRepo.findById.mockResolvedValue(order);

            const result = await svc.findById('order-1');

            expect(result).toBe(order);
            expect(orderRepo.findById).toHaveBeenCalledWith('order-1');
        });

        it('should return null when not found', async () => {
            orderRepo.findById.mockResolvedValue(null);
            expect(await svc.findById('nonexistent')).toBeNull();
        });
    });

    // ── transition ────────────────────────────────────────────────

    describe('transition', () => {
        it('should transition DRAFT → PENDING_PAYMENT', async () => {
            const updatedOrder = makeOrder({ status: OrderStatus.PENDING_PAYMENT });
            orderRepo.updateStatus.mockResolvedValue(updatedOrder);

            const result = await svc.transition(
                'order-1',
                OrderStatus.DRAFT,
                OrderStatus.PENDING_PAYMENT,
            );

            expect(result.status).toBe(OrderStatus.PENDING_PAYMENT);
            expect(lockService.acquireLock).toHaveBeenCalledWith(
                'lock:order:order-1:transition',
                10_000,
            );
            expect(lockService.releaseLock).toHaveBeenCalledWith(mockLockHandle);
        });

        it('should write outbox event on transition', async () => {
            orderRepo.updateStatus.mockResolvedValue(
                makeOrder({ status: OrderStatus.PENDING_PAYMENT }),
            );

            await svc.transition(
                'order-1',
                OrderStatus.DRAFT,
                OrderStatus.PENDING_PAYMENT,
                { reason: 'Payment initiated', actor: 'checkout' },
            );

            expect(outboxRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    topic: 'order.status_changed',
                    aggregateType: 'order',
                    aggregateId: 'order-1',
                    payload: expect.objectContaining({
                        orderId: 'order-1',
                        fromStatus: OrderStatus.DRAFT,
                        toStatus: OrderStatus.PENDING_PAYMENT,
                        reason: 'Payment initiated',
                        actor: 'checkout',
                    }),
                }),
            );
        });

        it('should throw InvalidTransitionError for illegal transition', async () => {
            await expect(
                svc.transition('order-1', OrderStatus.CANCELLED, OrderStatus.COMPLETED),
            ).rejects.toThrow(InvalidTransitionError);

            // Should NOT have acquired lock or called repo
            expect(lockService.acquireLock).not.toHaveBeenCalled();
            expect(orderRepo.updateStatus).not.toHaveBeenCalled();
        });

        it('should throw StaleOrderError when optimistic concurrency fails', async () => {
            // updateStatus returns null → row wasn't in expected status
            orderRepo.updateStatus.mockResolvedValue(null);

            await expect(
                svc.transition('order-1', OrderStatus.DRAFT, OrderStatus.PENDING_PAYMENT),
            ).rejects.toThrow(StaleOrderError);
        });

        it('should release lock even when updateStatus throws', async () => {
            orderRepo.updateStatus.mockRejectedValue(new Error('DB down'));

            await expect(
                svc.transition('order-1', OrderStatus.DRAFT, OrderStatus.PENDING_PAYMENT),
            ).rejects.toThrow('DB down');

            expect(lockService.releaseLock).toHaveBeenCalledWith(mockLockHandle);
        });

        it('should reject self-transition', async () => {
            await expect(
                svc.transition('order-1', OrderStatus.DRAFT, OrderStatus.DRAFT),
            ).rejects.toThrow(InvalidTransitionError);
        });
    });

    // ── full lifecycle ────────────────────────────────────────────

    describe('full order lifecycle', () => {
        it('should walk DRAFT → PENDING_PAYMENT → PAYMENT_AUTHORIZED → VENDOR_ORDER_PENDING → VENDOR_CONFIRMED → COMPLETED', async () => {
            const statuses = [
                [OrderStatus.DRAFT, OrderStatus.PENDING_PAYMENT],
                [OrderStatus.PENDING_PAYMENT, OrderStatus.PAYMENT_AUTHORIZED],
                [OrderStatus.PAYMENT_AUTHORIZED, OrderStatus.VENDOR_ORDER_PENDING],
                [OrderStatus.VENDOR_ORDER_PENDING, OrderStatus.VENDOR_CONFIRMED],
                [OrderStatus.VENDOR_CONFIRMED, OrderStatus.COMPLETED],
            ] as const;

            for (const [from, to] of statuses) {
                orderRepo.updateStatus.mockResolvedValue(makeOrder({ status: to }));
                const result = await svc.transition('order-1', from, to);
                expect(result.status).toBe(to);
            }

            expect(outboxRepo.create).toHaveBeenCalledTimes(5);
        });
    });
});
