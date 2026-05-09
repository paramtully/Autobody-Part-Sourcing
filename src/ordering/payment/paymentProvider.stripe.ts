/**
 * Stripe implementation of PaymentProviderAdapter.
 * This is the only file in src/ that imports 'stripe'.
 * All Stripe-specific concepts are contained here.
 *
 * Note on types: The ordering package uses module: "commonjs" which resolves
 * to Stripe's CJS type declarations. Those types only export Stripe.Stripe (the
 * instance type) and not the full Stripe.Event / Stripe.PaymentIntent namespace.
 * We use minimal inline interfaces and `unknown` casts for API responses where needed.
 */
import Stripe from 'stripe';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  IssueRefundInput,
  PaymentProviderAdapter,
  PaymentWebhookEvent,
} from './paymentProvider';
import { PaymentDeclinedError, PaymentInvalidRequestError, PaymentProviderError } from './paymentError';

// Stripe.Stripe is the instance type available in the CJS namespace.
type StripeClient = Stripe.Stripe;

// Minimal inline shapes for webhook objects — avoids relying on CJS-unavailable types.
interface StripeWebhookEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

export class StripePaymentAdapter implements PaymentProviderAdapter {
  readonly providerId = 'STRIPE';

  private readonly stripe: StripeClient;
  private readonly webhookSecret: string;

  constructor() {
    const stripeSecretKey = process.env['STRIPE_SECRET_KEY'];
    const stripeWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];

    if (!stripeSecretKey || !stripeWebhookSecret) {
      throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET env vars are required');
    }

    this.stripe = new Stripe(stripeSecretKey);
    this.webhookSecret = stripeWebhookSecret;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const subtotalMinor = input.lineItems.reduce((s, item) => s + item.amountMinor, 0);

    const lineItems = input.lineItems.map((item) => ({
      amount: item.amountMinor,
      reference: item.label,
      tax_behavior: 'exclusive' as const,
    }));

    const calculation = await this.wrapError(async () => {
      const result = await this.stripe.tax.calculations.create({
        currency: input.currency.toLowerCase(),
        line_items: lineItems,
        customer_details: {
          address: {
            line1: input.shippingAddress.line1,
            city: input.shippingAddress.city,
            state: input.shippingAddress.stateOrProvince,
            postal_code: input.shippingAddress.postalCode,
            country: input.shippingAddress.country,
          },
          address_source: 'shipping',
        },
      });
      return result as unknown as { id: string; tax_amount_exclusive: number; amount_total: number };
    });

    const taxMinor = calculation.tax_amount_exclusive;
    const totalMinor = subtotalMinor + taxMinor;

    const intent = await this.wrapError(async () => {
      const result = await this.stripe.paymentIntents.create(
        {
          amount: totalMinor,
          currency: input.currency.toLowerCase(),
          capture_method: 'manual',
          receipt_email: input.customerEmail,
          metadata: {
            ...input.metadata,
            order_id: input.orderId,
            tax_calculation_id: calculation.id,
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return result as unknown as { id: string; client_secret: string | null; amount: number };
    });

    return {
      providerPaymentId: intent.id,
      providerClientToken: intent.client_secret ?? '',
      taxMinor,
      totalMinor,
      providerMetadata: { taxCalculationId: calculation.id },
    };
  }

  async capturePayment(providerPaymentId: string): Promise<void> {
    await this.wrapError(() =>
      this.stripe.paymentIntents.capture(providerPaymentId, {}, {
        idempotencyKey: `capture:${providerPaymentId}`,
      }),
    );
  }

  async cancelPayment(providerPaymentId: string): Promise<void> {
    try {
      await this.stripe.paymentIntents.cancel(providerPaymentId);
    } catch (err: unknown) {
      if (isStripeError(err) && err.code === 'payment_intent_unexpected_state') return;
      throw this.normalizeError(err);
    }
  }

  async issueRefund(input: IssueRefundInput): Promise<{ providerRefundId: string }> {
    const refund = await this.wrapError(async () => {
      const result = await this.stripe.refunds.create(
        {
          payment_intent: input.providerPaymentId,
          amount: input.amountMinor,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return result as unknown as { id: string };
    });
    return { providerRefundId: refund.id };
  }

  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string>): PaymentWebhookEvent | null {
    const sig = headers['stripe-signature'];
    if (!sig) return null;

    let event: StripeWebhookEvent;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sig, this.webhookSecret) as unknown as StripeWebhookEvent;
    } catch {
      return null;
    }

    const obj = event.data.object;

    switch (event.type) {
      case 'payment_intent.amount_capturable_updated': {
        // taxMinor was computed at createPayment time and stored on the order row.
        // The webhook handler reads it from DB; we pass 0 as the field is unused there.
        return {
          type: 'PAYMENT_AUTHORIZED',
          providerPaymentId: String(obj['id'] ?? ''),
          amountMinor: Number(obj['amount'] ?? 0),
          taxMinor: 0,
          currency: String(obj['currency'] ?? ''),
        };
      }

      case 'payment_intent.succeeded': {
        return {
          type: 'PAYMENT_CAPTURED',
          providerPaymentId: String(obj['id'] ?? ''),
          amountMinor: Number(obj['amount_received'] ?? 0),
        };
      }

      case 'payment_intent.payment_failed': {
        const lastError = obj['last_payment_error'] as Record<string, unknown> | null | undefined;
        return {
          type: 'PAYMENT_FAILED',
          providerPaymentId: String(obj['id'] ?? ''),
          reason: String(lastError?.['message'] ?? 'Payment failed'),
        };
      }

      case 'charge.refunded': {
        const refunds = obj['refunds'] as { data?: Array<Record<string, unknown>> } | null | undefined;
        const refund = refunds?.data?.[0];
        const paymentIntentId = obj['payment_intent'];
        if (!paymentIntentId || !refund) {
          return { type: 'UNHANDLED', providerEventType: event.type };
        }
        return {
          type: 'REFUND_SUCCEEDED',
          providerPaymentId: String(paymentIntentId),
          providerRefundId: String(refund['id'] ?? ''),
          amountMinor: Number(refund['amount'] ?? 0),
        };
      }

      default:
        return { type: 'UNHANDLED', providerEventType: event.type };
    }
  }

  /**
   * Commit the Stripe Tax transaction after a successful capture.
   * Called only on PAYMENT_CAPTURED. Idempotent: swallows "already exists".
   */
  async finalizePayment(providerPaymentId: string): Promise<void> {
    const intent = await this.stripe.paymentIntents.retrieve(providerPaymentId) as unknown as {
      metadata?: Record<string, string>;
    };
    const taxCalculationId = intent.metadata?.['tax_calculation_id'];
    if (!taxCalculationId) return;

    try {
      await this.stripe.tax.transactions.createFromCalculation(
        {
          calculation: taxCalculationId,
          reference: providerPaymentId,
          expand: ['line_items'],
        },
        { idempotencyKey: `finalize:${providerPaymentId}` },
      );
    } catch (err: unknown) {
      if (isStripeError(err) && err.code === 'resource_already_exists') return;
      throw this.normalizeError(err);
    }
  }

  // ── Error handling ─────────────────────────────────────────────────────────

  private async wrapError<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: unknown) {
      throw this.normalizeError(err);
    }
  }

  private normalizeError(err: unknown): Error {
    if (!isStripeError(err)) return new PaymentProviderError('Payment failed');

    const errAny = err as unknown as Record<string, unknown>;
    console.error('Stripe error:', {
      message: err.message,
      type: err.type,
      code: err.code,
      decline_code: errAny['decline_code'],
      requestId: errAny['requestId'],
    });

    switch (err.type) {
      case 'StripeCardError':
        return new PaymentDeclinedError(err.message);
      case 'StripeInvalidRequestError':
        if (err.message?.includes('Tax calculation')) {
          return new PaymentProviderError('Tax calculation unavailable for this address');
        }
        return new PaymentInvalidRequestError(err.message);
      case 'StripeAuthenticationError':
        return new PaymentProviderError('Payment configuration error');
      case 'StripeRateLimitError':
      case 'StripeAPIError':
      case 'StripeConnectionError':
        return new PaymentProviderError('Payment provider unavailable');
      default:
        return new PaymentProviderError('Payment failed');
    }
  }
}

interface StripeErrorLike {
  type: string;
  message: string;
  code?: string;
}

function isStripeError(err: unknown): err is StripeErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    typeof (err as Record<string, unknown>)['type'] === 'string' &&
    ((err as Record<string, unknown>)['type'] as string).startsWith('Stripe')
  );
}
