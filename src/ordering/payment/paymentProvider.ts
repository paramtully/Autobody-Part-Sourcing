
// ── Payment gateway ──────────────────────────────────────────────
export interface CreatePaymentIntentInput {
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
}
  
export interface CreatePaymentIntentResult {
    providerPaymentId: string;
    clientSecret: string;
    providerMetadata: Record<string, unknown>;
}
  
export interface IssueRefundInput {
    providerPaymentId: string;
    amountMinor: number;
    idempotencyKey: string;
}
  
export interface PaymentProviderAdapter {
    /**
     * Creates a payment intent.
     * @param input - The input for creating a payment intent
     * @returns The result of the payment intent creation
     */
    createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResult>;
    /**
     * Captures a payment intent.
     * @param providerPaymentId - The ID of the payment intent to capture
     * @returns The result of the capture
     */
    capturePaymentIntent(providerPaymentId: string): Promise<void>;
    /**
     * Cancels a payment intent.
     * @param providerPaymentId - The ID of the payment intent to cancel
     * @returns The result of the cancellation
     */
    cancelPaymentIntent(providerPaymentId: string): Promise<void>;
    /**
     * Issues a refund.
     * @param input - The input for issuing a refund
     * @returns The result of the refund
     */
    issueRefund(input: IssueRefundInput): Promise<{ providerRefundId: string }>;
}