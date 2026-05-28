/**
 * Provider-agnostic payment webhook route.
 * Mounted at POST /webhooks/payment/:providerId with express.raw body.
 *
 * This file imports ONLY from @repo/ordering (the abstract interface) —
 * NO Stripe imports. Stripe-specific logic lives in StripePaymentAdapter.
 */
import express, { type Request, type Response } from 'express';
import type { PaymentProviderAdapter } from '@repo/ordering';
import { PaymentService } from '@repo/ordering';
import { StripePaymentAdapter } from '@repo/ordering/stripe';
import { ringOutboxDoorbell } from '../lib/outboxDoorbell.js';

const router = express.Router();

// express.raw must be applied before json() — this router is mounted before
// app.use(express.json()) in server.ts so that raw body is preserved.
router.use(express.raw({ type: 'application/json' }));

router.post('/:providerId', async (req: Request, res: Response) => {
  const { providerId } = req.params as { providerId: string };

  const paymentProvider: PaymentProviderAdapter = new StripePaymentAdapter();
  const paymentService: PaymentService = new PaymentService();

  if (providerId !== paymentProvider.providerId) {
    res.status(404).json({ error: 'Unknown payment provider' });
    return;
  }

  const rawBody = req.body as Buffer;
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] ?? '' : v ?? '']),
  );

  const event = paymentProvider.verifyAndParseWebhook(rawBody, headers);
  if (event === null) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  try {
    switch (event.type) {
      case 'PAYMENT_AUTHORIZED':
        await paymentService.onPaymentAuthorized(event.providerPaymentId);
        // Ring the SQS doorbell after the DB transaction commits so the
        // paymentWorker drains the outbox row immediately.
        void ringOutboxDoorbell();
        break;

      case 'PAYMENT_CAPTURED':
        await paymentService.onPaymentCaptured(event.providerPaymentId, paymentProvider);
        break;

      case 'PAYMENT_FAILED':
        await paymentService.onPaymentFailed(event.providerPaymentId, event.reason);
        break;

      case 'REFUND_SUCCEEDED':
        await paymentService.onRefundSucceeded(
          event.providerPaymentId,
          event.providerRefundId,
          event.amountMinor,
        );
        break;

      case 'UNHANDLED':
        // Acknowledge unknown event types so the provider stops retrying.
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[paymentWebhook] handler error', { eventType: event.type, err });
    // Return 500 so the provider retries delivery.
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;