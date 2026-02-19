import type { Currency } from '@domain/listing/currency';
import type { PaymentProviderAdapter } from '@interfaces/services/paymentService';
import type { OutboxRepository } from '@interfaces/repositories/outboxRepository';
import type { DistributedLockService } from '@interfaces/services/distributedLockService';

// ────────────────────────────────────────────────────────────────
// Domain types for payment records (kept simple — no separate table repo for now)
// ────────────────────────────────────────────────────────────────

export interface PaymentRecord {
    id: string;
    orderId: string;
    provider: string;
    providerPaymentId: string;
    providerIdempotencyKey: string;
    status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'CANCELLED' | 'FAILED';
    amountMinor: number;
    currency: Currency;
    authorizedAt: Date | null;
    authExpiresAt: Date | null;
    capturedAt: Date | null;
    cancelledAt: Date | null;
    failureReason: string | null;
    providerMetadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface RefundRecord {
    id: string;
    orderId: string;
    paymentId: string;
    provider: string;
    providerRefundId: string;
    amountMinor: number;
    serviceFeeRefundMinor: number;
    reason: string | null;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    initiatedBy: string;
    createdAt: Date;
}

/**
 * Error thrown when a capture is attempted on an expired auth.
 */
export class PaymentAuthExpiredError extends Error {
    constructor(public readonly orderId: string) {
        super(`Payment authorization expired for order ${orderId}`);
        this.name = 'PaymentAuthExpiredError';
    }
}

/**
 * Error thrown when a refund exceeds the max refundable amount.
 */
export class RefundExceedsMaxError extends Error {
    constructor(
        public readonly orderId: string,
        public readonly requested: number,
        public readonly maxRefundable: number,
    ) {
        super(`Refund of ${requested} exceeds max refundable ${maxRefundable} for order ${orderId}`);
        this.name = 'RefundExceedsMaxError';
    }
}

/**
 * Payment service — orchestrates payment lifecycle.
 * Uses a PaymentProviderAdapter (e.g. Stripe) behind the abstraction.
 */
export class PaymentService {
    constructor(
        private readonly providerAdapter: PaymentProviderAdapter,
        private readonly paymentRepo: PaymentRepository,
        private readonly outboxRepo: OutboxRepository,
        private readonly lockService: DistributedLockService,
    ) {}

    /**
     * Create a PaymentIntent and insert a PENDING payment record.
     */
    async createPaymentIntent(input: {
        orderId: string;
        amountMinor: number;
        currency: Currency;
        idempotencyKey: string;
    }): Promise<{ paymentId: string; providerPaymentId: string; clientSecret: string }> {
        const lock = await this.lockService.acquireLock(
            `lock:order:${input.orderId}:payment`,
            15_000,
        );

        try {
            const result = await this.providerAdapter.createPaymentIntent({
                amountMinor: input.amountMinor,
                currency: input.currency,
                idempotencyKey: input.idempotencyKey,
                metadata: { orderId: input.orderId },
            });

            const payment = await this.paymentRepo.create({
                orderId: input.orderId,
                provider: 'STRIPE',
                providerPaymentId: result.providerPaymentId,
                providerIdempotencyKey: input.idempotencyKey,
                status: 'PENDING',
                amountMinor: input.amountMinor,
                currency: input.currency,
                providerMetadata: result.providerMetadata,
            });

            return {
                paymentId: payment.id,
                providerPaymentId: result.providerPaymentId,
                clientSecret: result.clientSecret,
            };
        } finally {
            await this.lockService.releaseLock(lock);
        }
    }

    /**
     * Capture a previously authorized payment.
     * No-op if already captured (idempotent).
     * @throws PaymentAuthExpiredError if auth has expired
     */
    async capture(orderId: string): Promise<void> {
        const lock = await this.lockService.acquireLock(
            `lock:order:${orderId}:capture`,
            15_000,
        );

        try {
            const payment = await this.paymentRepo.findByOrderId(orderId);
            if (!payment) throw new Error(`No payment found for order ${orderId}`);

            // Idempotent: already captured
            if (payment.status === 'CAPTURED') return;

            // Auth expiry guard
            if (payment.authExpiresAt && payment.authExpiresAt < new Date()) {
                throw new PaymentAuthExpiredError(orderId);
            }

            await this.providerAdapter.capturePaymentIntent(payment.providerPaymentId);
            await this.paymentRepo.updateStatus(payment.id, 'CAPTURED', { capturedAt: new Date() });
        } finally {
            await this.lockService.releaseLock(lock);
        }
    }

    /**
     * Cancel (release) a payment authorization.
     */
    async cancel(orderId: string): Promise<void> {
        const payment = await this.paymentRepo.findByOrderId(orderId);
        if (!payment) return;

        if (payment.status === 'CANCELLED' || payment.status === 'FAILED') return;

        await this.providerAdapter.cancelPaymentIntent(payment.providerPaymentId);
        await this.paymentRepo.updateStatus(payment.id, 'CANCELLED', { cancelledAt: new Date() });
    }

    /**
     * Issue a refund. Validates amount against max refundable.
     * @throws RefundExceedsMaxError if amount exceeds remaining refundable
     */
    async issueRefund(input: {
        orderId: string;
        amountMinor: number;
        feePercentApplied: number;
        totalMinor: number;
        totalRefundedMinor: number;
        reason?: string;
        initiatedBy?: string;
    }): Promise<RefundRecord> {
        const lock = await this.lockService.acquireLock(
            `lock:order:${input.orderId}:refund`,
            15_000,
        );

        try {
            const maxRefundable = input.totalMinor - input.totalRefundedMinor;
            if (input.amountMinor > maxRefundable) {
                throw new RefundExceedsMaxError(input.orderId, input.amountMinor, maxRefundable);
            }

            const payment = await this.paymentRepo.findByOrderId(input.orderId);
            if (!payment) throw new Error(`No payment found for order ${input.orderId}`);

            const serviceFeeRefundMinor = Math.round(input.amountMinor * input.feePercentApplied);

            // Create refund record first (pending status)
            const refund = await this.paymentRepo.createRefund({
                orderId: input.orderId,
                paymentId: payment.id,
                provider: payment.provider,
                amountMinor: input.amountMinor,
                serviceFeeRefundMinor,
                reason: input.reason ?? null,
                status: 'PENDING',
                initiatedBy: input.initiatedBy ?? 'system',
            });

            // Call provider
            try {
                const result = await this.providerAdapter.issueRefund({
                    providerPaymentId: payment.providerPaymentId,
                    amountMinor: input.amountMinor,
                    idempotencyKey: `refund-${refund.id}`,
                });

                await this.paymentRepo.updateRefundStatus(refund.id, 'COMPLETED', result.providerRefundId);
                refund.status = 'COMPLETED';
                refund.providerRefundId = result.providerRefundId;
            } catch (err) {
                // Mark refund as failed but do NOT roll back total_refunded_minor
                await this.paymentRepo.updateRefundStatus(refund.id, 'FAILED');
                refund.status = 'FAILED';
            }

            return refund;
        } finally {
            await this.lockService.releaseLock(lock);
        }
    }

    /**
     * Find a payment by its provider payment ID (for webhook lookup).
     */
    async findByProviderPaymentId(providerPaymentId: string): Promise<PaymentRecord | null> {
        return this.paymentRepo.findByProviderPaymentId(providerPaymentId);
    }
}

// ────────────────────────────────────────────────────────────────
// Payment repository interface (internal to ordering infrastructure)
// ────────────────────────────────────────────────────────────────

export interface PaymentRepository {
    create(input: Omit<PaymentRecord, 'id' | 'authorizedAt' | 'authExpiresAt' | 'capturedAt' | 'cancelledAt' | 'failureReason' | 'createdAt' | 'updatedAt'>): Promise<PaymentRecord>;
    findByOrderId(orderId: string): Promise<PaymentRecord | null>;
    findByProviderPaymentId(providerPaymentId: string): Promise<PaymentRecord | null>;
    updateStatus(
        id: string,
        status: PaymentRecord['status'],
        timestamps?: { authorizedAt?: Date; authExpiresAt?: Date; capturedAt?: Date; cancelledAt?: Date; failureReason?: string },
    ): Promise<void>;

    createRefund(input: Omit<RefundRecord, 'id' | 'providerRefundId' | 'createdAt'> & { providerRefundId?: string }): Promise<RefundRecord>;
    updateRefundStatus(refundId: string, status: RefundRecord['status'], providerRefundId?: string): Promise<void>;
}
