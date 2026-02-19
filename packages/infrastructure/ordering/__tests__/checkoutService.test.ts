import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
    CheckoutService,
    ListingUnavailableError,
    VendorNotSupportedError,
    QuoteExpiredError,
    QuoteAlreadyUsedError,
    ListingHoldConflictError,
    type ListingForCheckout,
    type ListingHoldRepository,
    type ListingReader,
} from '../checkoutService';
import { Currency } from '@domain/listing/currency';
import { OrderStatus } from '@domain/order/orderStatus';
import { VendorOrderingMode } from '@domain/order/vendorOrderingMode';
import type { Order, ShippingAddress } from '@domain/order/order';
import type { CheckoutQuoteRepository, CheckoutQuote } from '@interfaces/repositories/checkoutQuoteRepository';
import type { OrderRepository, CreateOrderInput } from '@interfaces/repositories/orderRepository';
import type { OutboxRepository, OutboxEvent } from '@interfaces/repositories/outboxRepository';
import type { FeeConfigurationService } from '@interfaces/services/feeConfigurationService';
import type { DistributedLockService, LockHandle } from '@interfaces/services/distributedLockService';
import type { VendorOrderClient, ShippingQuoteResult } from '../../vendorOrdering/vendorOrderClient';
import { PaymentService } from '../paymentService';

// ─── Helpers ─────────────────────────────────────────────────────

const SHIPPING: ShippingAddress = {
    line1: '123 Main St',
    city: 'Portland',
    state: 'OR',
    postalCode: '97201',
    country: 'US',
};

const makeListing = (overrides: Partial<ListingForCheckout> = {}): ListingForCheckout => ({
    id: 'listing-1',
    vendorId: 'vendor-1',
    isActive: true,
    priceMinorMin: 5000,
    currency: Currency.USD,
    condition: 'NEW',
    partName: 'Brake Pad',
    partNumber: 'BP-001',
    vendorName: 'TestVendor',
    ...overrides,
});

const makeQuote = (overrides: Partial<CheckoutQuote> = {}): CheckoutQuote => ({
    id: 'quote-1',
    listingId: 'listing-1',
    vendorId: 'vendor-1',
    shippingAddress: SHIPPING,
    partPriceMinor: 5000,
    serviceFeeMinor: 150,
    feePercentApplied: 0.03,
    shippingMinor: 500,
    taxMinor: 400,
    totalMinor: 6050,
    currency: Currency.USD,
    vendorQuoteReference: null,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min from now
    usedAt: null,
    createdAt: new Date(),
    ...overrides,
});

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
    id: 'order-1',
    orderNumber: 'ORD-100000',
    status: OrderStatus.DRAFT,
    userId: null,
    contactEmail: 'test@example.com',
    contactPhone: null,
    orderLookupToken: 'lookup-token',
    idempotencyKey: 'idem-key',
    quoteId: 'quote-1',
    listingId: 'listing-1',
    vendorId: 'vendor-1',
    shippingAddress: SHIPPING,
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

const mockLockHandle: LockHandle = { key: 'test-lock', token: 'test-token' };

// ─── Mock factories ──────────────────────────────────────────────

const createMockListingReader = (): jest.Mocked<ListingReader> => ({
    findById: jest.fn<ListingReader['findById']>(),
    getVendorOrderingMode: jest.fn<ListingReader['getVendorOrderingMode']>(),
});

const createMockFeeService = (): jest.Mocked<FeeConfigurationService> => ({
    getCurrentFeePercent: jest.fn<FeeConfigurationService['getCurrentFeePercent']>().mockResolvedValue(0.03),
});

const createMockVendorOrderClient = (): jest.Mocked<VendorOrderClient> => ({
    getShippingQuote: jest.fn<VendorOrderClient['getShippingQuote']>(),
    placeOrder: jest.fn<VendorOrderClient['placeOrder']>(),
});

const createMockQuoteRepo = (): jest.Mocked<CheckoutQuoteRepository> => ({
    create: jest.fn<CheckoutQuoteRepository['create']>(),
    findById: jest.fn<CheckoutQuoteRepository['findById']>(),
    markUsed: jest.fn<CheckoutQuoteRepository['markUsed']>(),
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

const createMockHoldRepo = (): jest.Mocked<ListingHoldRepository> => ({
    findActiveHold: jest.fn<ListingHoldRepository['findActiveHold']>(),
    createHold: jest.fn<ListingHoldRepository['createHold']>(),
    releaseHold: jest.fn<ListingHoldRepository['releaseHold']>(),
});

const createMockOutboxRepo = (): jest.Mocked<OutboxRepository> => ({
    create: jest.fn<OutboxRepository['create']>().mockResolvedValue({
        id: 'evt-1', topic: '', aggregateType: '', aggregateId: '', payload: {},
        createdAt: new Date(), publishedAt: null, failedAt: null, retryCount: 0,
    }),
    findUnpublished: jest.fn<OutboxRepository['findUnpublished']>(),
    markPublished: jest.fn<OutboxRepository['markPublished']>(),
    markFailed: jest.fn<OutboxRepository['markFailed']>(),
    incrementRetryCount: jest.fn<OutboxRepository['incrementRetryCount']>(),
});

const createMockPaymentService = (): jest.Mocked<Pick<PaymentService, 'createPaymentIntent'>> => ({
    createPaymentIntent: jest.fn<PaymentService['createPaymentIntent']>().mockResolvedValue({
        paymentId: 'pay-1',
        providerPaymentId: 'pi_test',
        clientSecret: 'cs_test_secret',
    }),
});

const createMockLockService = (): jest.Mocked<DistributedLockService> => ({
    acquireLock: jest.fn<DistributedLockService['acquireLock']>().mockResolvedValue(mockLockHandle),
    releaseLock: jest.fn<DistributedLockService['releaseLock']>().mockResolvedValue(undefined),
});

// ─── Tests ───────────────────────────────────────────────────────

describe('CheckoutService', () => {
    let listingReader: jest.Mocked<ListingReader>;
    let feeService: jest.Mocked<FeeConfigurationService>;
    let vendorClient: jest.Mocked<VendorOrderClient>;
    let quoteRepo: jest.Mocked<CheckoutQuoteRepository>;
    let orderRepo: jest.Mocked<OrderRepository>;
    let holdRepo: jest.Mocked<ListingHoldRepository>;
    let outboxRepo: jest.Mocked<OutboxRepository>;
    let paymentService: jest.Mocked<Pick<PaymentService, 'createPaymentIntent'>>;
    let lockService: jest.Mocked<DistributedLockService>;
    let svc: CheckoutService;

    beforeEach(() => {
        listingReader = createMockListingReader();
        feeService = createMockFeeService();
        vendorClient = createMockVendorOrderClient();
        quoteRepo = createMockQuoteRepo();
        orderRepo = createMockOrderRepo();
        holdRepo = createMockHoldRepo();
        outboxRepo = createMockOutboxRepo();
        paymentService = createMockPaymentService();
        lockService = createMockLockService();

        svc = new CheckoutService(
            listingReader,
            feeService,
            vendorClient,
            quoteRepo,
            orderRepo,
            holdRepo,
            outboxRepo,
            paymentService as any,
            lockService,
        );
    });

    // ── getQuote ──────────────────────────────────────────────────

    describe('getQuote', () => {
        it('should return a quote with correct pricing for a valid listing', async () => {
            listingReader.findById.mockResolvedValue(makeListing());
            listingReader.getVendorOrderingMode.mockResolvedValue(VendorOrderingMode.API_SYNC);
            vendorClient.getShippingQuote.mockResolvedValue({
                status: 'QUOTED',
                shippingMinor: 500,
                taxMinor: 400,
                validForMinutes: 30,
            });
            quoteRepo.create.mockResolvedValue(makeQuote());

            const result = await svc.getQuote({
                listingId: 'listing-1',
                shippingAddress: SHIPPING,
            });

            expect(result.quoteId).toBe('quote-1');
            expect(result.partPriceMinor).toBe(5000);
            expect(result.serviceFeeMinor).toBe(150); // round(5000 * 0.03)
            expect(result.totalMinor).toBe(6050);
        });

        it('should throw ListingUnavailableError for inactive listing', async () => {
            listingReader.findById.mockResolvedValue(makeListing({ isActive: false }));

            await expect(
                svc.getQuote({ listingId: 'listing-1', shippingAddress: SHIPPING }),
            ).rejects.toThrow(ListingUnavailableError);
        });

        it('should throw ListingUnavailableError for nonexistent listing', async () => {
            listingReader.findById.mockResolvedValue(null);

            await expect(
                svc.getQuote({ listingId: 'listing-1', shippingAddress: SHIPPING }),
            ).rejects.toThrow(ListingUnavailableError);
        });

        it('should throw VendorNotSupportedError when vendor ordering mode is NOT_SUPPORTED', async () => {
            listingReader.findById.mockResolvedValue(makeListing());
            listingReader.getVendorOrderingMode.mockResolvedValue(VendorOrderingMode.NOT_SUPPORTED);

            await expect(
                svc.getQuote({ listingId: 'listing-1', shippingAddress: SHIPPING }),
            ).rejects.toThrow(VendorNotSupportedError);
        });

        it('should throw VendorNotSupportedError when shipping quote is NOT_SUPPORTED', async () => {
            listingReader.findById.mockResolvedValue(makeListing());
            listingReader.getVendorOrderingMode.mockResolvedValue(VendorOrderingMode.API_SYNC);
            vendorClient.getShippingQuote.mockResolvedValue({ status: 'NOT_SUPPORTED' });

            await expect(
                svc.getQuote({ listingId: 'listing-1', shippingAddress: SHIPPING }),
            ).rejects.toThrow(VendorNotSupportedError);
        });
    });

    // ── confirm ───────────────────────────────────────────────────

    describe('confirm', () => {
        it('should create an order, listing hold, payment intent, and return clientSecret', async () => {
            orderRepo.findByIdempotencyKey.mockResolvedValue(null);
            quoteRepo.findById.mockResolvedValue(makeQuote());
            listingReader.findById.mockResolvedValue(makeListing());
            listingReader.getVendorOrderingMode.mockResolvedValue(VendorOrderingMode.API_SYNC);
            holdRepo.findActiveHold.mockResolvedValue(null);
            orderRepo.create.mockResolvedValue(makeOrder());
            orderRepo.updateStatus.mockResolvedValue(makeOrder({ status: OrderStatus.PENDING_PAYMENT }));

            const result = await svc.confirm({
                quoteId: 'quote-1',
                contactEmail: 'test@example.com',
                idempotencyKey: 'idem-key',
            });

            expect(result.orderId).toBe('order-1');
            expect(result.clientSecret).toBe('cs_test_secret');
            expect(holdRepo.createHold).toHaveBeenCalled();
            expect(quoteRepo.markUsed).toHaveBeenCalledWith('quote-1');
            expect(outboxRepo.create).toHaveBeenCalledTimes(2); // order.created + order.status_changed
        });

        it('should return existing order for duplicate idempotencyKey (no-op)', async () => {
            const existingOrder = makeOrder({ status: OrderStatus.PENDING_PAYMENT });
            orderRepo.findByIdempotencyKey.mockResolvedValue(existingOrder);

            const result = await svc.confirm({
                quoteId: 'quote-1',
                contactEmail: 'test@example.com',
                idempotencyKey: 'idem-key',
            });

            expect(result.orderId).toBe('order-1');
            // Should NOT create a new order
            expect(orderRepo.create).not.toHaveBeenCalled();
        });

        it('should throw QuoteExpiredError when quote is expired', async () => {
            orderRepo.findByIdempotencyKey.mockResolvedValue(null);
            quoteRepo.findById.mockResolvedValue(
                makeQuote({ expiresAt: new Date(Date.now() - 1000) }),
            );

            await expect(
                svc.confirm({
                    quoteId: 'quote-1',
                    contactEmail: 'test@example.com',
                    idempotencyKey: 'idem-key',
                }),
            ).rejects.toThrow(QuoteExpiredError);
        });

        it('should throw QuoteAlreadyUsedError when quote was already used', async () => {
            orderRepo.findByIdempotencyKey.mockResolvedValue(null);
            quoteRepo.findById.mockResolvedValue(
                makeQuote({ usedAt: new Date() }),
            );

            await expect(
                svc.confirm({
                    quoteId: 'quote-1',
                    contactEmail: 'test@example.com',
                    idempotencyKey: 'idem-key',
                }),
            ).rejects.toThrow(QuoteAlreadyUsedError);
        });

        it('should throw ListingHoldConflictError when listing is held by another order', async () => {
            orderRepo.findByIdempotencyKey.mockResolvedValue(null);
            quoteRepo.findById.mockResolvedValue(makeQuote());
            listingReader.findById.mockResolvedValue(makeListing());
            listingReader.getVendorOrderingMode.mockResolvedValue(VendorOrderingMode.API_SYNC);
            holdRepo.findActiveHold.mockResolvedValue({
                id: 'hold-other',
                orderId: 'order-other',
                expiresAt: new Date(Date.now() + 10 * 60 * 1000), // Not expired
            });

            await expect(
                svc.confirm({
                    quoteId: 'quote-1',
                    contactEmail: 'test@example.com',
                    idempotencyKey: 'idem-key',
                }),
            ).rejects.toThrow(ListingHoldConflictError);
        });

        it('should release lock even when order creation fails', async () => {
            orderRepo.findByIdempotencyKey.mockResolvedValue(null);
            quoteRepo.findById.mockResolvedValue(makeQuote());
            listingReader.findById.mockResolvedValue(makeListing());
            listingReader.getVendorOrderingMode.mockResolvedValue(VendorOrderingMode.API_SYNC);
            holdRepo.findActiveHold.mockResolvedValue(null);
            orderRepo.create.mockRejectedValue(new Error('DB constraint violation'));

            await expect(
                svc.confirm({
                    quoteId: 'quote-1',
                    contactEmail: 'test@example.com',
                    idempotencyKey: 'idem-key',
                }),
            ).rejects.toThrow('DB constraint violation');

            expect(lockService.releaseLock).toHaveBeenCalledWith(mockLockHandle);
        });

        it('should allow hold if existing hold is expired', async () => {
            orderRepo.findByIdempotencyKey.mockResolvedValue(null);
            quoteRepo.findById.mockResolvedValue(makeQuote());
            listingReader.findById.mockResolvedValue(makeListing());
            listingReader.getVendorOrderingMode.mockResolvedValue(VendorOrderingMode.API_SYNC);
            holdRepo.findActiveHold.mockResolvedValue({
                id: 'hold-expired',
                orderId: 'order-old',
                expiresAt: new Date(Date.now() - 1000), // Expired
            });
            orderRepo.create.mockResolvedValue(makeOrder());
            orderRepo.updateStatus.mockResolvedValue(makeOrder({ status: OrderStatus.PENDING_PAYMENT }));

            const result = await svc.confirm({
                quoteId: 'quote-1',
                contactEmail: 'test@example.com',
                idempotencyKey: 'idem-key',
            });

            expect(result.orderId).toBe('order-1');
            expect(holdRepo.createHold).toHaveBeenCalled();
        });
    });
});
