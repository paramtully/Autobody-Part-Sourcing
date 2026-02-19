import type { Currency } from '@domain/listing/currency';

/**
 * Payment status as seen by the platform (provider-agnostic).
 */
export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'CANCELLED' | 'FAILED';

/**
 * Result of creating a payment intent.
 */
export interface CreatePaymentResult {
    paymentId: string;
    providerPaymentId: string;
    clientSecret: string; // Passed to the frontend for Stripe Elements / PaymentSheet
}

/**
 * Provider-agnostic abstraction over a payment gateway.
 * The implementation (e.g. StripePaymentAdapter) lives in infrastructure.
 */
export interface PaymentProviderAdapter {
    createPaymentIntent(input: {
        amountMinor: number;
        currency: Currency;
        idempotencyKey: string;
        metadata: Record<string, string>;
    }): Promise<{
        providerPaymentId: string;
        clientSecret: string;
        providerMetadata: Record<string, unknown>;
    }>;

    capturePaymentIntent(providerPaymentId: string): Promise<void>;

    cancelPaymentIntent(providerPaymentId: string): Promise<void>;

    issueRefund(input: {
        providerPaymentId: string;
        amountMinor: number;
        idempotencyKey: string;
    }): Promise<{
        providerRefundId: string;
    }>;
}
