import type { ShippingAddress } from '../clients/vendorOrderClient';

// ── Line items ────────────────────────────────────────────────────────────────

export interface PaymentLineItem {
  label: 'item' | 'shipping' | 'service_fee';
  amountMinor: number;
}

// ── Create payment ────────────────────────────────────────────────────────────

/** Provider-agnostic input — no "PaymentIntent" terminology. */
export interface CreatePaymentInput {
  orderId: string;
  /** Pre-tax line items: item, shipping, service_fee. */
  lineItems: PaymentLineItem[];
  /** Used by providers that support location-based tax calculation. */
  shippingAddress: ShippingAddress;
  customerEmail: string;
  currency: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface CreatePaymentResult {
  /** Stripe: paymentIntent.id. Other providers: their equivalent. */
  providerPaymentId: string;
  /** Stripe: client_secret. Browser passes this to the provider SDK to complete payment. */
  providerClientToken: string;
  /** Provider-calculated tax on the subtotal (sum of lineItems). */
  taxMinor: number;
  /** Sum of lineItems + taxMinor. This is the amount that will be authorized/charged. */
  totalMinor: number;
  /** Opaque, server-only. Providers may store tax calculation ids etc. here. */
  providerMetadata: Record<string, unknown>;
}

// ── Refund ────────────────────────────────────────────────────────────────────

export interface IssueRefundInput {
  providerPaymentId: string;
  amountMinor: number;
  idempotencyKey: string;
}

// ── Webhook events ────────────────────────────────────────────────────────────

/**
 * Normalized payment lifecycle events. The adapter translates provider-specific
 * webhook payloads into this union — route handlers never import Stripe types.
 *
 * Two-phase capture flow:
 *   PAYMENT_AUTHORIZED — customer completed payment; funds are held (NOT yet captured).
 *                        Triggers vendor order placement.
 *   PAYMENT_CAPTURED   — backend called capturePayment after vendor confirmed;
 *                        funds are taken. Triggers tax transaction commit.
 */
export type PaymentWebhookEvent =
  | { type: 'PAYMENT_AUTHORIZED'; providerPaymentId: string; amountMinor: number; taxMinor: number; currency: string }
  | { type: 'PAYMENT_CAPTURED'; providerPaymentId: string; amountMinor: number }
  | { type: 'PAYMENT_FAILED'; providerPaymentId: string; reason: string }
  | { type: 'REFUND_SUCCEEDED'; providerPaymentId: string; providerRefundId: string; amountMinor: number }
  | { type: 'UNHANDLED'; providerEventType: string };

// ── Adapter interface ─────────────────────────────────────────────────────────

export interface PaymentProviderAdapter {
  /** Matches the paymentProviderEnum values (e.g. 'STRIPE'). */
  readonly providerId: string;

  /**
   * Create a payment authorization (manual capture). The customer completes
   * payment using providerClientToken in their browser. Funds are held until
   * capturePayment or cancelPayment is called.
   */
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /**
   * Capture an authorized payment. Called after the vendor confirms the order.
   * Idempotent: uses provider-level idempotency keys.
   */
  capturePayment(providerPaymentId: string): Promise<void>;

  /**
   * Release an authorization hold without charging the customer. Called when
   * the vendor rejects the order. Preferred over issueRefund in this flow
   * because nothing has been captured yet.
   * Idempotent: swallows "already cancelled/captured" provider errors.
   */
  cancelPayment(providerPaymentId: string): Promise<void>;

  /**
   * Issue a refund after a completed capture. Used for post-capture corrections
   * (e.g. support-initiated refund). NOT used in the vendor-reject path.
   */
  issueRefund(input: IssueRefundInput): Promise<{ providerRefundId: string }>;

  /**
   * Verify the webhook signature and translate the provider event into a
   * normalized PaymentWebhookEvent. Returns null if the signature is invalid
   * or the event type is unrecognised — the route should respond 401 on null.
   */
  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string>): PaymentWebhookEvent | null;

  /**
   * Finalize provider-specific post-capture work (e.g. Stripe Tax transaction
   * commit). Called by the webhook route on PAYMENT_CAPTURED. Must be idempotent.
   * Providers that have no post-capture work implement this as a no-op.
   */
  finalizePayment(providerPaymentId: string): Promise<void>;
}
