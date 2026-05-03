import type { OrderRepo } from '@repo/db/repositories/order.repository';
import type { OutboxRepo } from '@repo/db/repositories/outbox.repository';
import type { VendorOrderClientRegistry } from '../clients/registry';
import type { VendorOrderRequest, VendorOrderResult } from '../clients/vendorOrderClient';
import type { PaymentProviderAdapter } from '../payment/paymentProvider';
import { PaymentProviderError } from '../payment/paymentError';

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
  constructor(
    private readonly vendorRegistry: VendorOrderClientRegistry,
    private readonly orderRepo: OrderRepo,
    private readonly outboxRepo: OutboxRepo,
    private readonly paymentProvider: PaymentProviderAdapter,
  ) {}

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
        // Optimistic status transition — only proceeds if still PAYMENT_AUTHORIZED.
        const updated = await this.orderRepo.updateStatus(
          orderId,
          'PAYMENT_AUTHORIZED',
          'VENDOR_CONFIRMED',
        );
        if (!updated) {
          // Already transitioned (replay); still try to capture idempotently.
        }

        await this.orderRepo.updateVendorOrder(orderId, {
          vendorOrderId: result.vendorOrderId,
        });

        if (!order.paymentProviderPaymentId) {
          console.error('[VendorOrderService] CONFIRMED but no providerPaymentId', { orderId });
          return;
        }

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
        await this.orderRepo.updateStatus(orderId, 'PAYMENT_AUTHORIZED', 'CANCELLED');
        await this.orderRepo.setPaymentStatus(orderId, 'CANCELLED');

        if (order.paymentProviderPaymentId) {
          try {
            await this.paymentProvider.cancelPayment(order.paymentProviderPaymentId);
          } catch (err) {
            // cancelPayment is idempotent by design, but log unexpected errors.
            console.error('[VendorOrderService] cancelPayment error', { orderId, err });
          }
        }

        await this.outboxRepo.create({
          topic: 'order.vendor_status_changed',
          aggregateId: orderId,
          payload: { orderId, status: 'REJECTED', reason: result.reason },
        });
        break;
      }

      case 'PENDING': {
        await this.orderRepo.updateStatus(orderId, 'PAYMENT_AUTHORIZED', 'VENDOR_ORDER_PENDING');
        await this.orderRepo.updateVendorOrder(orderId, {
          vendorOrderId: result.vendorOrderId,
        });
        break;
      }

      case 'ERROR': {
        if (result.retryable) {
          // Leave status as-is; outbox poller will retry via order.payment_authorized event.
          console.warn('[VendorOrderService] retryable error from vendor', { orderId, error: result.error });
        } else {
          // Non-retryable: cancel the payment authorization and fail the order.
          await this.orderRepo.updateStatus(orderId, 'PAYMENT_AUTHORIZED', 'FAILED');
          if (order.paymentProviderPaymentId) {
            await this.paymentProvider.cancelPayment(order.paymentProviderPaymentId).catch((e) => {
              console.error('[VendorOrderService] cancelPayment on non-retryable error', { orderId, e });
            });
          }
        }
        break;
      }
    }
  }
}
