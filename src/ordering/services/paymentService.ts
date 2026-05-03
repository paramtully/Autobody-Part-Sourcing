import type { OrderRepo } from '@repo/db/repositories/order.repository';
import type { OutboxRepo } from '@repo/db/repositories/outbox.repository';
import type { PaymentProviderAdapter } from '../payment/paymentProvider';

/**
 * Handles normalized payment lifecycle events from the webhook route.
 * Has no Stripe imports — depends only on PaymentProviderAdapter interface.
 */
export class PaymentService {
  constructor(
    private readonly orderRepo: OrderRepo,
    private readonly outboxRepo: OutboxRepo,
    private readonly paymentProvider: PaymentProviderAdapter,
  ) {}

  /**
   * Called when PAYMENT_AUTHORIZED arrives (Stripe: amount_capturable_updated).
   * Funds are held but NOT captured yet.
   * Writes taxMinor/totalMinor from the order row (set at createPayment time)
   * and transitions the order to PAYMENT_AUTHORIZED.
   * Idempotent: no-op if paymentStatus is already past PENDING.
   */
  async onPaymentAuthorized(providerPaymentId: string): Promise<void> {
    const order = await this.orderRepo.findByProviderPaymentId(providerPaymentId);
    if (!order) {
      console.error('[PaymentService] onPaymentAuthorized: order not found', { providerPaymentId });
      return;
    }
    if (order.paymentStatus !== 'PENDING') {
      // Already processed (idempotent replay)
      return;
    }

    await this.orderRepo.setPaymentStatus(order.id, 'AUTHORIZED');
    await this.orderRepo.updateStatus(order.id, 'PENDING_PAYMENT', 'PAYMENT_AUTHORIZED');

    await this.outboxRepo.create({
      topic: 'order.payment_authorized',
      aggregateId: order.id,
      payload: { orderId: order.id },
    });
  }

  /**
   * Called when PAYMENT_CAPTURED arrives (Stripe: payment_intent.succeeded).
   * Funds have been taken from the customer.
   * Idempotent: no-op if paymentStatus is already CAPTURED.
   */
  async onPaymentCaptured(
    providerPaymentId: string,
    paymentAdapter: PaymentProviderAdapter,
  ): Promise<void> {
    const order = await this.orderRepo.findByProviderPaymentId(providerPaymentId);
    if (!order) {
      console.error('[PaymentService] onPaymentCaptured: order not found', { providerPaymentId });
      return;
    }
    if (order.paymentStatus === 'CAPTURED') return;

    await this.orderRepo.setPaymentStatus(order.id, 'CAPTURED');
    await paymentAdapter.finalizePayment(providerPaymentId);
  }

  /**
   * Called when PAYMENT_FAILED arrives (Stripe: payment_intent.payment_failed).
   */
  async onPaymentFailed(providerPaymentId: string, reason: string): Promise<void> {
    const order = await this.orderRepo.findByProviderPaymentId(providerPaymentId);
    if (!order) {
      console.error('[PaymentService] onPaymentFailed: order not found', { providerPaymentId });
      return;
    }

    await this.orderRepo.setPaymentStatus(order.id, 'FAILED');
    await this.orderRepo.updateStatus(order.id, order.status, 'FAILED');

    console.error('[PaymentService] Payment failed', { orderId: order.id, reason });
  }

  /**
   * Called when REFUND_SUCCEEDED arrives (Stripe: charge.refunded).
   * Updates totalRefundedMinor; marks REFUNDED if fully refunded.
   */
  async onRefundSucceeded(
    providerPaymentId: string,
    providerRefundId: string,
    amountMinor: number,
  ): Promise<void> {
    const order = await this.orderRepo.findByProviderPaymentId(providerPaymentId);
    if (!order) {
      console.error('[PaymentService] onRefundSucceeded: order not found', { providerPaymentId });
      return;
    }

    await this.orderRepo.addRefundedAmount(order.id, amountMinor);

    const newRefundedTotal = order.totalRefundedMinor + amountMinor;
    if (newRefundedTotal >= order.totalMinor) {
      await this.orderRepo.setPaymentStatus(order.id, 'REFUNDED');
      await this.orderRepo.updateStatus(order.id, order.status, 'REFUNDED');
    }

    console.log('[PaymentService] Refund recorded', {
      orderId: order.id,
      providerRefundId,
      amountMinor,
    });
  }

  /**
   * Issue a refund. Used for support-initiated refunds post-capture (not vendor
   * reject — that path uses cancelPayment before capture).
   */
  async issueRefund(orderId: string, amountMinor: number): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order?.paymentProviderPaymentId) {
      throw new Error(`Order ${orderId} has no payment provider id`);
    }
    const idempotencyKey = `refund:${orderId}:${amountMinor}`;
    await this.paymentProvider.issueRefund({
      providerPaymentId: order.paymentProviderPaymentId,
      amountMinor,
      idempotencyKey,
    });
  }
}
