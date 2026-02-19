import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { VendorOrderService } from '../vendorOrderService';
import { OrderStatus } from '@domain/order/orderStatus';
import { VendorOrderingMode } from '@domain/order/vendorOrderingMode';
import { Currency } from '@domain/listing/currency';
import type { Order } from '@domain/order/order';
import type { OrderRepository } from '@interfaces/repositories/orderRepository';
import type { DistributedLockService, LockHandle } from '@interfaces/services/distributedLockService';
import type { VendorOrderClient, VendorOrderResult } from '../../vendorOrdering/vendorOrderClient';
import { VendorOrderClientRegistry } from '../../vendorOrdering/vendorOrderClientRegistry';
import { OrderService } from '../orderService';
import { PaymentService, type ListingHoldRepository } from '../checkoutService';

// ─── Helpers ─────────────────────────────────────────────────────

const mockLockHandle: LockHandle = { key: 'test-lock', token: 'test-token' };

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
    id: 'order-1',
    orderNumber: 'ORD-100000',
    status: OrderStatus.PAYMENT_AUTHORIZED,
    userId: null,
    contactEmail: 'test@example.com',
    contactPhone: null,
    orderLookupToken: 'lookup-token',
    idempotencyKey: 'idem-key',
    quoteId: 'quote-1',
    listingId: 'listing-1',
    vendorId: 'vendor-1',
    shippingAddress: { line1: '123 Main', city: 'Portland', state: 'OR', postalCode: '97201', country: 'US' },
    snapshot: {
        partName: 'Brake Pad',
        partNumber: 'BP-001',
        condition: 'NEW' as any,
        vendorName: 'TestVendor',
        listingPriceMinor: 5000,
        currency: Currency.USD,
    },
    pricing: {
        partPriceMinor: 5000,
        serviceFeeMinor: 150,
        feePercentApplied: 0.03,
        shippingMinor: 500,
        taxMinor: 400,
        totalMinor: 6050,
        currency: Currency.USD,
    },
    totalRefundedMinor: 0,
    vendorOrderId: null,
    vendorOrderingMode: VendorOrderingMode.API_SYNC,
    vendorOrderPlacedAt: null,
    vendorOrderConfirmedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
});

// ─── Mock factories ──────────────────────────────────────────────

const createMockVendorClient = (): jest.Mocked<VendorOrderClient> => ({
    getShippingQuote: jest.fn<VendorOrderClient['getShippingQuote']>(),
    placeOrder: jest.fn<VendorOrderClient['placeOrder']>(),
});

const createMockOrderRepo = (): jest.Mocked<OrderRepository> => ({
    create: jest.fn<OrderRepository['create']>(),
    findById: jest.fn<OrderRepository['findById']>(),
    findByLookupToken: jest.fn<OrderRepository['findByLookupToken']>(),
    findByIdempotencyKey: jest.fn<OrderRepository['findByIdempotencyKey']>(),
    updateStatus: jest.fn<OrderRepository['updateStatus']>(),
    update: jest.fn<OrderRepository['update']>(),
    findStuckOrders: jest.fn<OrderRepository['findStuckOrders']>(),
});

const createMockOrderService = (): jest.Mocked<Pick<OrderService, 'transition'>> => ({
    transition: jest.fn<OrderService['transition']>().mockResolvedValue(makeOrder()),
});

const createMockPaymentService = (): jest.Mocked<Pick<PaymentService, 'cancel'>> => ({
    cancel: jest.fn<PaymentService['cancel']>().mockResolvedValue(undefined),
});

const createMockHoldRepo = (): jest.Mocked<ListingHoldRepository> => ({
    findActiveHold: jest.fn<ListingHoldRepository['findActiveHold']>(),
    createHold: jest.fn<ListingHoldRepository['createHold']>(),
    releaseHold: jest.fn<ListingHoldRepository['releaseHold']>().mockResolvedValue(undefined),
});

const createMockLockService = (): jest.Mocked<DistributedLockService> => ({
    acquireLock: jest.fn<DistributedLockService['acquireLock']>().mockResolvedValue(mockLockHandle),
    releaseLock: jest.fn<DistributedLockService['releaseLock']>().mockResolvedValue(undefined),
});

// ─── Tests ───────────────────────────────────────────────────────

describe('VendorOrderService', () => {
    let vendorClient: jest.Mocked<VendorOrderClient>;
    let registry: VendorOrderClientRegistry;
    let orderService: jest.Mocked<Pick<OrderService, 'transition'>>;
    let orderRepo: jest.Mocked<OrderRepository>;
    let paymentService: jest.Mocked<Pick<PaymentService, 'cancel'>>;
    let holdRepo: jest.Mocked<ListingHoldRepository>;
    let lockService: jest.Mocked<DistributedLockService>;
    let svc: VendorOrderService;

    beforeEach(() => {
        vendorClient = createMockVendorClient();
        registry = new VendorOrderClientRegistry();
        registry.register(VendorOrderingMode.API_SYNC, vendorClient);
        registry.register(VendorOrderingMode.EMAIL_MANUAL, vendorClient);

        orderService = createMockOrderService();
        orderRepo = createMockOrderRepo();
        paymentService = createMockPaymentService();
        holdRepo = createMockHoldRepo();
        lockService = createMockLockService();

        svc = new VendorOrderService(
            registry,
            orderService as any,
            orderRepo,
            paymentService as any,
            lockService,
            holdRepo,
        );
    });

    describe('placeOrder — CONFIRMED result', () => {
        it('should transition to VENDOR_CONFIRMED and record vendor order ID', async () => {
            orderRepo.findById.mockResolvedValue(makeOrder());
            orderRepo.update.mockResolvedValue(makeOrder());
            vendorClient.placeOrder.mockResolvedValue({
                status: 'CONFIRMED',
                vendorOrderId: 'vendor-order-abc',
            });

            await svc.placeOrder('order-1');

            expect(orderRepo.update).toHaveBeenCalledWith(
                'order-1',
                expect.objectContaining({ vendorOrderId: 'vendor-order-abc' }),
            );
            expect(orderService.transition).toHaveBeenCalledWith(
                'order-1',
                OrderStatus.PAYMENT_AUTHORIZED,
                OrderStatus.VENDOR_CONFIRMED,
                expect.any(Object),
            );
        });
    });

    describe('placeOrder — PENDING result', () => {
        it('should transition to VENDOR_ORDER_PENDING', async () => {
            orderRepo.findById.mockResolvedValue(makeOrder());
            orderRepo.update.mockResolvedValue(makeOrder());
            vendorClient.placeOrder.mockResolvedValue({
                status: 'PENDING',
                vendorOrderId: 'vendor-pending-abc',
            });

            await svc.placeOrder('order-1');

            expect(orderService.transition).toHaveBeenCalledWith(
                'order-1',
                OrderStatus.PAYMENT_AUTHORIZED,
                OrderStatus.VENDOR_ORDER_PENDING,
                expect.any(Object),
            );
        });
    });

    describe('placeOrder — REJECTED result', () => {
        it('should cancel payment, release hold, and transition to CANCELLED', async () => {
            orderRepo.findById.mockResolvedValue(makeOrder());
            vendorClient.placeOrder.mockResolvedValue({
                status: 'REJECTED',
                reason: 'Part discontinued',
            });

            await svc.placeOrder('order-1');

            expect(paymentService.cancel).toHaveBeenCalledWith('order-1');
            expect(holdRepo.releaseHold).toHaveBeenCalledWith('order-1');
            expect(orderService.transition).toHaveBeenCalledWith(
                'order-1',
                OrderStatus.PAYMENT_AUTHORIZED,
                OrderStatus.CANCELLED,
                expect.objectContaining({ reason: expect.stringContaining('Part discontinued') }),
            );
        });
    });

    describe('placeOrder — ERROR with retries', () => {
        it('should retry retryable errors up to MAX_RETRIES then fail', async () => {
            orderRepo.findById.mockResolvedValue(makeOrder());
            vendorClient.placeOrder.mockResolvedValue({
                status: 'ERROR',
                error: 'timeout',
                retryable: true,
            });

            await svc.placeOrder('order-1');

            // Should have called placeOrder 3 times (MAX_RETRIES)
            expect(vendorClient.placeOrder).toHaveBeenCalledTimes(3);
            // Should cancel payment and hold on terminal failure
            expect(paymentService.cancel).toHaveBeenCalledWith('order-1');
            expect(holdRepo.releaseHold).toHaveBeenCalledWith('order-1');
            expect(orderService.transition).toHaveBeenCalledWith(
                'order-1',
                OrderStatus.PAYMENT_AUTHORIZED,
                OrderStatus.FAILED,
                expect.any(Object),
            );
        });

        it('should NOT retry non-retryable errors', async () => {
            orderRepo.findById.mockResolvedValue(makeOrder());
            vendorClient.placeOrder.mockResolvedValue({
                status: 'ERROR',
                error: 'invalid_request',
                retryable: false,
            });

            await svc.placeOrder('order-1');

            expect(vendorClient.placeOrder).toHaveBeenCalledTimes(1);
            expect(orderService.transition).toHaveBeenCalledWith(
                'order-1',
                OrderStatus.PAYMENT_AUTHORIZED,
                OrderStatus.FAILED,
                expect.any(Object),
            );
        });
    });

    describe('placeOrder — idempotency', () => {
        it('should skip if order is already past PAYMENT_AUTHORIZED', async () => {
            orderRepo.findById.mockResolvedValue(
                makeOrder({ status: OrderStatus.VENDOR_CONFIRMED }),
            );

            await svc.placeOrder('order-1');

            expect(vendorClient.placeOrder).not.toHaveBeenCalled();
        });
    });

    describe('placeOrder — EMAIL_MANUAL mode', () => {
        it('should transition to VENDOR_ORDER_PENDING on success', async () => {
            const emailOrder = makeOrder({
                vendorOrderingMode: VendorOrderingMode.EMAIL_MANUAL,
            });
            orderRepo.findById.mockResolvedValue(emailOrder);
            orderRepo.update.mockResolvedValue(emailOrder);
            vendorClient.placeOrder.mockResolvedValue({
                status: 'PENDING',
                vendorOrderId: 'email-ref-abc',
            });

            await svc.placeOrder('order-1');

            expect(orderService.transition).toHaveBeenCalledWith(
                'order-1',
                OrderStatus.PAYMENT_AUTHORIZED,
                OrderStatus.VENDOR_ORDER_PENDING,
                expect.objectContaining({ reason: expect.stringContaining('email') }),
            );
        });

        it('should fail gracefully and cancel payment on email send failure', async () => {
            const emailOrder = makeOrder({
                vendorOrderingMode: VendorOrderingMode.EMAIL_MANUAL,
            });
            orderRepo.findById.mockResolvedValue(emailOrder);
            vendorClient.placeOrder.mockResolvedValue({
                status: 'ERROR',
                error: 'SMTP failure',
                retryable: false,
            });

            await svc.placeOrder('order-1');

            expect(paymentService.cancel).toHaveBeenCalledWith('order-1');
            expect(holdRepo.releaseHold).toHaveBeenCalledWith('order-1');
            expect(orderService.transition).toHaveBeenCalledWith(
                'order-1',
                OrderStatus.PAYMENT_AUTHORIZED,
                OrderStatus.FAILED,
                expect.any(Object),
            );
        });
    });

    describe('lock management', () => {
        it('should always release lock, even on unhandled errors', async () => {
            orderRepo.findById.mockRejectedValue(new Error('DB crashed'));

            await expect(svc.placeOrder('order-1')).rejects.toThrow('DB crashed');

            expect(lockService.releaseLock).toHaveBeenCalledWith(mockLockHandle);
        });
    });
});
