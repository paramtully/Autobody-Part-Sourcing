import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
    PaymentService,
    PaymentAuthExpiredError,
    RefundExceedsMaxError,
    type PaymentRecord,
    type RefundRecord,
    type PaymentRepository,
} from '../paymentService';
import { Currency } from '@domain/listing/currency';
import type { PaymentProviderAdapter } from '@interfaces/services/paymentService';
import type { OutboxRepository } from '@interfaces/repositories/outboxRepository';
import type { DistributedLockService, LockHandle } from '@interfaces/services/distributedLockService';

// ─── Helpers ─────────────────────────────────────────────────────

const mockLockHandle: LockHandle = { key: 'test-lock', token: 'test-token' };

const makePayment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
    id: 'pay-1',
    orderId: 'order-1',
    provider: 'STRIPE',
    providerPaymentId: 'pi_test_123',
    providerIdempotencyKey: 'idem-pay-1',
    status: 'AUTHORIZED',
    amountMinor: 6050,
    currency: Currency.USD,
    authorizedAt: new Date('2025-01-01T12:00:00Z'),
    authExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    capturedAt: null,
    cancelledAt: null,
    failureReason: null,
    providerMetadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
});

const makeRefund = (overrides: Partial<RefundRecord> = {}): RefundRecord => ({
    id: 'refund-1',
    orderId: 'order-1',
    paymentId: 'pay-1',
    provider: 'STRIPE',
    providerRefundId: 're_test_123',
    amountMinor: 3000,
    serviceFeeRefundMinor: 90,
    reason: 'Customer request',
    status: 'PENDING',
    initiatedBy: 'admin',
    createdAt: new Date(),
    ...overrides,
});

// ─── Mock factories ──────────────────────────────────────────────

const createMockProvider = (): jest.Mocked<PaymentProviderAdapter> => ({
    createPaymentIntent: jest.fn<PaymentProviderAdapter['createPaymentIntent']>().mockResolvedValue({
        providerPaymentId: 'pi_test_new',
        clientSecret: 'cs_test_secret',
        providerMetadata: {},
    }),
    capturePaymentIntent: jest.fn<PaymentProviderAdapter['capturePaymentIntent']>().mockResolvedValue(undefined),
    cancelPaymentIntent: jest.fn<PaymentProviderAdapter['cancelPaymentIntent']>().mockResolvedValue(undefined),
    issueRefund: jest.fn<PaymentProviderAdapter['issueRefund']>().mockResolvedValue({
        providerRefundId: 're_test_new',
    }),
});

const createMockPaymentRepo = (): jest.Mocked<PaymentRepository> => ({
    create: jest.fn<PaymentRepository['create']>().mockResolvedValue(makePayment()),
    findByOrderId: jest.fn<PaymentRepository['findByOrderId']>(),
    findByProviderPaymentId: jest.fn<PaymentRepository['findByProviderPaymentId']>(),
    updateStatus: jest.fn<PaymentRepository['updateStatus']>().mockResolvedValue(undefined),
    createRefund: jest.fn<PaymentRepository['createRefund']>().mockResolvedValue(makeRefund()),
    updateRefundStatus: jest.fn<PaymentRepository['updateRefundStatus']>().mockResolvedValue(undefined),
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

const createMockLockService = (): jest.Mocked<DistributedLockService> => ({
    acquireLock: jest.fn<DistributedLockService['acquireLock']>().mockResolvedValue(mockLockHandle),
    releaseLock: jest.fn<DistributedLockService['releaseLock']>().mockResolvedValue(undefined),
});

// ─── Tests ───────────────────────────────────────────────────────

describe('PaymentService', () => {
    let provider: jest.Mocked<PaymentProviderAdapter>;
    let paymentRepo: jest.Mocked<PaymentRepository>;
    let outboxRepo: jest.Mocked<OutboxRepository>;
    let lockService: jest.Mocked<DistributedLockService>;
    let svc: PaymentService;

    beforeEach(() => {
        provider = createMockProvider();
        paymentRepo = createMockPaymentRepo();
        outboxRepo = createMockOutboxRepo();
        lockService = createMockLockService();
        svc = new PaymentService(provider, paymentRepo, outboxRepo, lockService);
    });

    // ── createPaymentIntent ──────────────────────────────────────

    describe('createPaymentIntent', () => {
        it('should call provider and persist payment record', async () => {
            const result = await svc.createPaymentIntent({
                orderId: 'order-1',
                amountMinor: 6050,
                currency: Currency.USD,
                idempotencyKey: 'idem-pay-1',
            });

            expect(result.clientSecret).toBe('cs_test_secret');
            expect(provider.createPaymentIntent).toHaveBeenCalledWith(
                expect.objectContaining({
                    amountMinor: 6050,
                    currency: Currency.USD,
                    idempotencyKey: 'idem-pay-1',
                }),
            );
            expect(paymentRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderId: 'order-1',
                    status: 'PENDING',
                    amountMinor: 6050,
                }),
            );
        });

        it('should acquire and release lock', async () => {
            await svc.createPaymentIntent({
                orderId: 'order-1',
                amountMinor: 6050,
                currency: Currency.USD,
                idempotencyKey: 'idem-pay-1',
            });

            expect(lockService.acquireLock).toHaveBeenCalledWith(
                'lock:order:order-1:payment',
                15_000,
            );
            expect(lockService.releaseLock).toHaveBeenCalledWith(mockLockHandle);
        });

        it('should release lock if provider throws', async () => {
            provider.createPaymentIntent.mockRejectedValue(new Error('Stripe down'));

            await expect(
                svc.createPaymentIntent({
                    orderId: 'order-1',
                    amountMinor: 6050,
                    currency: Currency.USD,
                    idempotencyKey: 'idem-pay-1',
                }),
            ).rejects.toThrow('Stripe down');

            expect(lockService.releaseLock).toHaveBeenCalledWith(mockLockHandle);
        });
    });

    // ── capture ──────────────────────────────────────────────────

    describe('capture', () => {
        it('should capture an authorized payment', async () => {
            paymentRepo.findByOrderId.mockResolvedValue(makePayment({ status: 'AUTHORIZED' }));

            await svc.capture('order-1');

            expect(provider.capturePaymentIntent).toHaveBeenCalledWith('pi_test_123');
            expect(paymentRepo.updateStatus).toHaveBeenCalledWith(
                'pay-1',
                'CAPTURED',
                expect.objectContaining({ capturedAt: expect.any(Date) }),
            );
        });

        it('should be idempotent — no-op if already captured', async () => {
            paymentRepo.findByOrderId.mockResolvedValue(makePayment({ status: 'CAPTURED' }));

            await svc.capture('order-1');

            expect(provider.capturePaymentIntent).not.toHaveBeenCalled();
        });

        it('should throw PaymentAuthExpiredError when auth is expired', async () => {
            paymentRepo.findByOrderId.mockResolvedValue(
                makePayment({ authExpiresAt: new Date(Date.now() - 1000) }),
            );

            await expect(svc.capture('order-1')).rejects.toThrow(PaymentAuthExpiredError);
        });

        it('should throw when no payment found', async () => {
            paymentRepo.findByOrderId.mockResolvedValue(null);

            await expect(svc.capture('order-1')).rejects.toThrow('No payment found');
        });
    });

    // ── cancel ───────────────────────────────────────────────────

    describe('cancel', () => {
        it('should cancel an authorized payment', async () => {
            paymentRepo.findByOrderId.mockResolvedValue(makePayment({ status: 'AUTHORIZED' }));

            await svc.cancel('order-1');

            expect(provider.cancelPaymentIntent).toHaveBeenCalledWith('pi_test_123');
            expect(paymentRepo.updateStatus).toHaveBeenCalledWith(
                'pay-1',
                'CANCELLED',
                expect.objectContaining({ cancelledAt: expect.any(Date) }),
            );
        });

        it('should be no-op if already cancelled', async () => {
            paymentRepo.findByOrderId.mockResolvedValue(makePayment({ status: 'CANCELLED' }));

            await svc.cancel('order-1');

            expect(provider.cancelPaymentIntent).not.toHaveBeenCalled();
        });

        it('should be no-op if no payment exists', async () => {
            paymentRepo.findByOrderId.mockResolvedValue(null);

            await svc.cancel('order-1');

            expect(provider.cancelPaymentIntent).not.toHaveBeenCalled();
        });
    });

    // ── issueRefund ──────────────────────────────────────────────

    describe('issueRefund', () => {
        it('should compute proportional service fee refund', async () => {
            paymentRepo.findByOrderId.mockResolvedValue(makePayment({ status: 'CAPTURED' }));

            const result = await svc.issueRefund({
                orderId: 'order-1',
                amountMinor: 3000,
                feePercentApplied: 0.03,
                totalMinor: 6050,
                totalRefundedMinor: 0,
                reason: 'Partial refund',
                initiatedBy: 'admin',
            });

            // Service fee refund = round(3000 * 0.03) = 90
            expect(paymentRepo.createRefund).toHaveBeenCalledWith(
                expect.objectContaining({
                    amountMinor: 3000,
                    serviceFeeRefundMinor: 90,
                }),
            );
        });

        it('should throw RefundExceedsMaxError when refund > remaining', async () => {
            await expect(
                svc.issueRefund({
                    orderId: 'order-1',
                    amountMinor: 5000,
                    feePercentApplied: 0.03,
                    totalMinor: 6050,
                    totalRefundedMinor: 3000, // Only 3050 remaining
                }),
            ).rejects.toThrow(RefundExceedsMaxError);
        });

        it('should mark refund as FAILED if provider throws', async () => {
            paymentRepo.findByOrderId.mockResolvedValue(makePayment({ status: 'CAPTURED' }));
            provider.issueRefund.mockRejectedValue(new Error('Stripe refund failed'));

            const result = await svc.issueRefund({
                orderId: 'order-1',
                amountMinor: 1000,
                feePercentApplied: 0.03,
                totalMinor: 6050,
                totalRefundedMinor: 0,
            });

            expect(result.status).toBe('FAILED');
            expect(paymentRepo.updateRefundStatus).toHaveBeenCalledWith('refund-1', 'FAILED');
        });

        it('should mark refund as COMPLETED on success', async () => {
            paymentRepo.findByOrderId.mockResolvedValue(makePayment({ status: 'CAPTURED' }));

            const result = await svc.issueRefund({
                orderId: 'order-1',
                amountMinor: 1000,
                feePercentApplied: 0.03,
                totalMinor: 6050,
                totalRefundedMinor: 0,
            });

            expect(result.status).toBe('COMPLETED');
            expect(paymentRepo.updateRefundStatus).toHaveBeenCalledWith(
                'refund-1',
                'COMPLETED',
                're_test_new',
            );
        });
    });
});
