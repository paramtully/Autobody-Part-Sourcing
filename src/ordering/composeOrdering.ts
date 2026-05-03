/**
 * Factory that wires all ordering dependencies together.
 * The only place in this file that knows about Stripe is the type of
 * `paymentProvider` — and that type is `PaymentProviderAdapter`, not `Stripe`.
 *
 * StripePaymentAdapter construction happens in apps/api/server.ts only.
 */
import type { Db } from '../db/client';
import { ListingRepo } from '../db/schema/listing.repository';
import { OrderRepo, QuoteRepo } from '@repo/db/repositories/order.repository';
import { OutboxRepo } from '@repo/db/repositories/outbox.repository';
import type { PaymentProviderAdapter } from './payment/paymentProvider';
import type { VendorOrderClientRegistry } from './clients/registry';
import { CheckoutService } from './services/checkoutService';
import { PaymentService } from './services/paymentService';
import { VendorOrderService } from './services/vendorOrderService';

export interface OrderingDeps {
  db: Db;
  paymentProvider: PaymentProviderAdapter;
  vendorRegistry: VendorOrderClientRegistry;
  /** Platform fee as a decimal fraction (e.g. 0.02 for 2%). Read from process.env.PLATFORM_FEE_PERCENT. */
  feePercent: number;
}

export interface OrderingServices {
  checkout: CheckoutService;
  payments: PaymentService;
  vendorOrders: VendorOrderService;
  outboxRepo: OutboxRepo;
}

export function composeOrdering(deps: OrderingDeps): OrderingServices {
  const orderRepo = new OrderRepo(deps.db);
  const quoteRepo = new QuoteRepo(deps.db);
  const listingRepo = new ListingRepo(deps.db);
  const outboxRepo = new OutboxRepo(deps.db);

  const payments = new PaymentService(orderRepo, outboxRepo, deps.paymentProvider);

  const checkout = new CheckoutService(
    listingRepo,
    quoteRepo,
    orderRepo,
    outboxRepo,
    deps.vendorRegistry,
    deps.paymentProvider,
    deps.feePercent,
  );

  const vendorOrders = new VendorOrderService(
    deps.vendorRegistry,
    orderRepo,
    outboxRepo,
    deps.paymentProvider,
  );

  return { checkout, payments, vendorOrders, outboxRepo };
}
