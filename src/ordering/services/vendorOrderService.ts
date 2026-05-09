import { OrderRepo } from '@repo/db/repositories/order.repository';
import { OutboxRepo } from '@repo/db/repositories/outbox.repository';
import { Db, db } from '@repo/db';
import { ORDER_TOPICS } from '../events/topics';
import { VendorOrderClientRegistry } from '../clients/registry';
import { VendorOrderRequest, VendorOrderResult } from '../clients/vendorOrderClient';
import { PaymentProviderAdapter } from '../payment/paymentProvider';
import { PaymentProviderError } from '../payment/paymentError';
import { StripePaymentAdapter } from '../payment/paymentProvider.stripe';

/**
 * Dispatches vendor order placement and handles the result.
 * Has no Stripe imports — depends only on PaymentProviderAdapter interface.
 *
 * Capture/cancel flow:
 *   CONFIRMED → capturePayment (idempotent) → orders.status = VENDOR_CONFIRMED
 *   REJECTED  → cancelPayment (idempotent) → orders.status = CANCELLED, paymentStatus = CANCELLED
 *   PENDING   → orders.status = VENDOR_ORDER_PENDING (vendor webhook / email callback later)
 */
export class VendorOrderService {
  private readonly vendorRegistry: VendorOrderClientRegistry = new VendorOrderClientRegistry();
  private readonly orderRepo: OrderRepo = new OrderRepo();
  private readonly outboxRepo: OutboxRepo = new OutboxRepo();
  private readonly paymentProvider: PaymentProviderAdapter = new StripePaymentAdapter();

  /**
   * Place a vendor order for an order in PAYMENT_AUTHORIZED status.
   * Short-circuits if the order is not in the expected status (idempotent replay guard).
   */
  async placeOrder(orderId: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      console.error('[VendorOrderService] placeOrder: order not found', { orderId });
      return;
    }
    if (order.status !== 'PAYMENT_AUTHORIZED') {
      // Already processed (idempotent replay)
      return;
    }

    const client = this.vendorRegistry.get(order.vendorId);
    const request: VendorOrderRequest = {
      orderId: order.id,
      vendorId: order.vendorId,
      listingId: order.listingId,
      partNumber: '', // populated below via listing lookup if needed; vendor clients have it
      quantity: 1,
      shippingAddress: order.shippingAddress as Parameters<typeof client.placeOrder>[0]['shippingAddress'],
      contactEmail: order.contactEmail,
    };

    let result: VendorOrderResult;
    try {
      result = await client.placeOrder(request);
    } catch (err) {
      console.error('[VendorOrderService] placeOrder: vendor client error', { orderId, err });
      result = { status: 'ERROR', error: String(err), retryable: true };
    }

    await this.handleResult(orderId, result);
  }

  /**
   * Handle a vendor order result (used by both placeOrder and inbound callbacks).
   * Idempotent: each branch checks the current order status before acting.
   */
  async handleResult(orderId: string, result: VendorOrderResult): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) return;

    switch (result.status) {
      case 'CONFIRMED': {
        // Atomically transition status, record vendorOrderId, and publish outbox event.
        // updateStatus is optimistic — returns null if already past PAYMENT_AUTHORIZED (replay).
        // updateVendorOrder runs unconditionally; on replay it's a harmless same-value write.
        await db.transaction(async (tx) => {
          const txDb = tx as unknown as Db;

          const updated = await new OrderRepo(txDb).updateStatus(orderId, 'PAYMENT_AUTHORIZED', 'VENDOR_CONFIRMED');
          await new OrderRepo(txDb).updateVendorOrder(orderId, { vendorOrderId: result.vendorOrderId });

          if (updated) {
            await new OutboxRepo(txDb).create({
              topic: ORDER_TOPICS.VENDOR_STATUS_CHANGED,
              aggregateId: orderId,
              payload: { orderId, status: 'CONFIRMED', vendorOrderId: result.vendorOrderId },
            });
          }
        });

        if (!order.paymentProviderPaymentId) {
          console.error('[VendorOrderService] CONFIRMED but no providerPaymentId', { orderId });
          return;
        }

        // capturePayment is called after the transaction commits. It is idempotent on replay.
        try {
          await this.paymentProvider.capturePayment(order.paymentProviderPaymentId);
        } catch (err) {
          if (err instanceof PaymentProviderError) {
            // Capture failed (e.g. hold expired). Log — manual recovery needed.
            console.error('[VendorOrderService] capturePayment failed', { orderId, err });
          } else {
            throw err;
          }
        }
        break;
      }

      case 'REJECTED': {
        // Atomically cancel order status, payment status, and schedule the hold release.
        // PAYMENT_CANCEL_REQUIRED is picked up by the outbox poller and retried up to 5x.
        await db.transaction(async (tx) => {
          const txDb = tx as unknown as Db;
          const txOutbox = new OutboxRepo(txDb);

          await new OrderRepo(txDb).updateStatus(orderId, 'PAYMENT_AUTHORIZED', 'CANCELLED');
          await new OrderRepo(txDb).setPaymentStatus(orderId, 'CANCELLED');
          await txOutbox.create({
            topic: ORDER_TOPICS.VENDOR_STATUS_CHANGED,
            aggregateId: orderId,
            payload: { orderId, status: 'REJECTED', reason: result.reason },
          });
          if (order.paymentProviderPaymentId) {
            await txOutbox.create({
              topic: ORDER_TOPICS.PAYMENT_CANCEL_REQUIRED,
              aggregateId: orderId,
              payload: { orderId, providerPaymentId: order.paymentProviderPaymentId },
            });
          }
        });
        break;
      }

      case 'PENDING': {
        await db.transaction(async (tx) => {
          const txDb = tx as unknown as Db;
          const txOrderRepo = new OrderRepo(txDb);

          await txOrderRepo.updateStatus(orderId, 'PAYMENT_AUTHORIZED', 'VENDOR_ORDER_PENDING');
          await txOrderRepo.updateVendorOrder(orderId, { vendorOrderId: result.vendorOrderId });
        });
        break;
      }

      case 'ERROR': {
        if (result.retryable) {
          // Leave status as-is; outbox poller will retry via order.payment_authorized event.
          console.warn('[VendorOrderService] retryable error from vendor', { orderId, error: result.error });
        } else {
          // Non-retryable: atomically fail the order + payment status and schedule the hold release.
          // PAYMENT_CANCEL_REQUIRED is picked up by the outbox poller and retried up to 5x.
          await db.transaction(async (tx) => {
            const txDb = tx as unknown as Db;
            const txOrderRepo = new OrderRepo(txDb);

            await txOrderRepo.updateStatus(orderId, 'PAYMENT_AUTHORIZED', 'FAILED');
            await txOrderRepo.setPaymentStatus(orderId, 'CANCELLED');
            if (order.paymentProviderPaymentId) {
              await new OutboxRepo(txDb).create({
                topic: ORDER_TOPICS.PAYMENT_CANCEL_REQUIRED,
                aggregateId: orderId,
                payload: { orderId, providerPaymentId: order.paymentProviderPaymentId },
              });
            }
          });
        }
        break;
      }
    }
  }
}
