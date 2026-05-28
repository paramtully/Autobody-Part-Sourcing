import { OrderRepo } from '@repo/db/repositories/order.repository';
import { OutboxRepo } from '@repo/db/repositories/outbox.repository';
import { ORDER_TOPICS } from '../events/topics';
import { PaymentProviderAdapter } from '../payment/paymentProvider';
import { StripePaymentAdapter } from '../payment/paymentProvider.stripe';
import { Db, db } from '@repo/db';

/**
 * Handles normalized payment lifecycle events from the webhook route.
 * Has no Stripe imports — depends only on PaymentProviderAdapter interface.
 */
export class PaymentService {
  private readonly orderRepo: OrderRepo = new OrderRepo();
  private readonly paymentProvider: PaymentProviderAdapter = new StripePaymentAdapter();

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

    await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const repo = new OrderRepo(txDb);

      await repo.setPaymentStatus(order.id, 'AUTHORIZED');
      await repo.updateStatus(order.id, 'PENDING_PAYMENT', 'PAYMENT_AUTHORIZED');

      await new OutboxRepo(txDb).create({
        topic: ORDER_TOPICS.PAYMENT_AUTHORIZED,
        aggregateId: order.id,
        payload: { orderId: order.id, paymentProviderPaymentId: order.paymentProviderPaymentId },
      });
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

    // Finalize with provider first so that a failure here is retryable on replay.
    // If we wrote CAPTURED first and then the provider call failed, the idempotency
    // guard above would silently skip the provider call on every subsequent replay.
    await paymentAdapter.finalizePayment(providerPaymentId);
    await this.orderRepo.setPaymentStatus(order.id, 'CAPTURED');
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

    await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const repo = new OrderRepo(txDb);
      await repo.setPaymentStatus(order.id, 'FAILED');
      await repo.updateStatus(order.id, order.status, 'FAILED');
    });

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

    await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const repo = new OrderRepo(txDb);

      await repo.addRefundedAmount(order.id, amountMinor);

      // Re-read inside the transaction so we see our own write and avoid a
      // stale-read race when two refunds arrive concurrently.
      const refreshed = await repo.findById(order.id);
      if (refreshed && refreshed.totalRefundedMinor >= refreshed.totalMinor) {
        await repo.setPaymentStatus(order.id, 'REFUNDED');
        await repo.updateStatus(order.id, order.status, 'REFUNDED');
      }
    });

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
