// CheckoutService implementation lives in src/ordering/services/checkoutService.ts
// (inside the @repo/ordering workspace). This file re-exports it so any code
// that imports from src/orders/checkout gets the same class.
export {
  CheckoutService,
  CheckoutError,
  QuoteExpiredError,
  NotFoundError,
} from '../ordering/services/checkoutService';
export type {
  CheckoutQuoteResponse,
  CheckoutConfirmResponse,
} from '../ordering/services/checkoutService';
