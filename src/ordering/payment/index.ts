// Export only the provider-agnostic interface types.
// StripePaymentAdapter is intentionally NOT exported here — import it directly
// from './paymentProvider.stripe' only in composeOrdering.ts and apps/api/server.ts.
export type {
  PaymentProviderAdapter,
  PaymentLineItem,
  CreatePaymentInput,
  CreatePaymentResult,
  IssueRefundInput,
  PaymentWebhookEvent,
} from './paymentProvider';
export { PaymentDeclinedError, PaymentInvalidRequestError, PaymentProviderError } from './paymentError';
