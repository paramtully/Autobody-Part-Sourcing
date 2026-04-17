/**
 * Stripe implementation of PaymentProviderAdapter.
 * Sole payment provider for MVP.
 */
import Stripe from 'stripe';
import type {
  CreatePaymentIntentInput,
  CreatePaymentIntentResult,
  IssueRefundInput,
  PaymentProviderAdapter,
} from './paymentProvider';
import { PaymentDeclinedError, PaymentInvalidRequestError, PaymentProviderError } from './paymentError';

type StripeClient = Stripe.Stripe;

export class StripePaymentAdapter implements PaymentProviderAdapter {
  private readonly stripe: StripeClient;

  constructor(stripe: StripeClient | string) {
    this.stripe = typeof stripe === 'string' ? new Stripe(stripe) : stripe;
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResult> {
    const intent = await this.handleErrorWrapper(async () => 
      this.stripe.paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        capture_method: 'manual',
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    ));
    return {
      providerPaymentId: intent.id,
      clientSecret: intent.client_secret ?? '',
      providerMetadata: { status: intent.status },
    };
  }

  async capturePaymentIntent(providerPaymentId: string): Promise<void> {
    await this.handleErrorWrapper(async () => 
      this.stripe.paymentIntents.capture(providerPaymentId)
    );
  }

  async cancelPaymentIntent(providerPaymentId: string): Promise<void> {
    await this.handleErrorWrapper(async () => 
      this.stripe.paymentIntents.cancel(providerPaymentId)
    );
  }

  async issueRefund(input: IssueRefundInput): Promise<{ providerRefundId: string }> {
    const refund = await this.handleErrorWrapper(async () => 
      this.stripe.refunds.create(
      {
        payment_intent: input.providerPaymentId,
        amount: input.amountMinor,
      },
      { idempotencyKey: input.idempotencyKey },
    ));
    return { providerRefundId: refund.id };
  }

  /**
   * Wraps a function in a try/catch block and handles Stripe errors.
   * @param fn - The function to wrap
   * @returns The result of the function
   */
  private async handleErrorWrapper<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
  
    } catch (err: any) {
      // Optional: log once, centrally
      console.error('Stripe error:', {
        message: err?.message,
        type: err?.type,
        code: err?.code,
        decline_code: err?.decline_code,
        requestId: err?.requestId,
      });
  
      switch (err?.type) {
        case 'StripeCardError':
          // Card declined, insufficient funds, etc.
          throw new PaymentDeclinedError(err.message);
  
        case 'StripeInvalidRequestError':
          // Bad params, missing fields, invalid state
          throw new PaymentInvalidRequestError(err.message);
  
        case 'StripeAuthenticationError':
          // Wrong API key — this is on you, not the user
          throw new PaymentProviderError('Payment configuration error');
  
        case 'StripeRateLimitError':
        case 'StripeAPIError':
        case 'StripeConnectionError':
          // Stripe down / network / throttling
          throw new PaymentProviderError('Payment provider unavailable');
  
        default:
          // Unknown / unexpected
          throw new PaymentProviderError('Payment failed');
      }
    }
  }
}
