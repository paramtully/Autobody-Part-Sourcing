import { ListingRepo } from '@repo/db/repositories/listing.repository';
import { OrderRepo, QuoteRepo } from '@repo/db/repositories/order.repository';
import { OutboxRepo } from '@repo/db/repositories/outbox.repository';
import { ORDER_TOPICS } from '../events/topics';
import { VendorOrderClientRegistry } from '../clients/registry';
import type { OrderQuoteResult, ShippingAddress } from '../clients/vendorOrderClient';
import { PaymentProviderAdapter, CreatePaymentResult } from '../payment/paymentProvider';
import { StripePaymentAdapter } from '../payment/paymentProvider.stripe';
import { ConfirmBody, QuoteBody } from '@repo/db/schema/order.schema';
import { Db, db } from '@repo/db/client';

// ── Response DTOs ─────────────────────────────────────────────────────────────

/** What the browser receives from POST /checkout/quote. No tax, no total. */
export interface CheckoutQuoteResponse {
  quoteId: string;
  itemPriceMinor: number;
  shippingMinor: number;
  /** 2% of (item + shipping), computed server-side. */
  serviceFeeMinor: number;
  currency: string;
  /** ISO 8601 timestamp; client should show a "quote expires" countdown. */
  expiresAt: string;
}

/** What the browser receives from POST /checkout/confirm. */
export interface CheckoutConfirmResponse {
  orderId: string;
  orderLookupToken: string;
  /** Provider client token (Stripe: client_secret). Browser passes this to provider SDK. */
  providerClientToken: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CheckoutService {
  private readonly listingRepo: ListingRepo = new ListingRepo();
  private readonly quoteRepo: QuoteRepo = new QuoteRepo();
  private readonly orderRepo: OrderRepo = new OrderRepo();
  private readonly vendorRegistry: VendorOrderClientRegistry = new VendorOrderClientRegistry();
  private readonly paymentProvider: PaymentProviderAdapter = new StripePaymentAdapter();
  private readonly feePercent: number = parseFloat(process.env['PLATFORM_FEE_PERCENT'] ?? '0.02');
  private readonly quoteTtlMinutes: number = 15;

  /**
   * Create a checkout quote.
   * - Calls the vendor for real-time item price + shipping + vendor tax.
   * - Computes our 2% platform service fee server-side.
   * - Persists the quote to checkout_quotes (vendor tax stored for reconciliation,
   *   not returned to the client).
   * - Returns only: itemPriceMinor, shippingMinor, serviceFeeMinor, currency, expiresAt.
   *
   * EMAIL_MANUAL vendors are blocked — their confirmation latency exceeds the 7-day
   * Stripe authorization hold window.
   */
  async createQuote(input: QuoteBody): Promise<CheckoutQuoteResponse> {
    const listing = await this.listingRepo.findById(input.listingId);
    if (!listing) throw new NotFoundError(`Listing ${input.listingId} not found`);
    if (!listing.isActive) throw new CheckoutError('This listing is no longer available');

    // Block EMAIL_MANUAL vendors — auth hold window not safe for multi-day replies.
    if (listing.vendor.orderingMode === 'EMAIL_MANUAL') {
      throw new CheckoutError('Vendor not available for online ordering');
    }

    const client = this.vendorRegistry.get(listing.vendorId);

    const vq: OrderQuoteResult = await client.getQuote({
      listingId: listing.id,
      vendorId: listing.vendorId,
      partNumber: listing.partIdentifier.value,
      shippingAddress: input.shippingAddress,
      currency: listing.currency,
    });

    const serviceFeeMinor = Math.round(this.feePercent * (vq.itemPriceMinor + vq.shippingMinor));
    // pre-tax subtotal stored on the quote (Payment Provider computes final tax at confirm)
    const subtotalMinor = vq.itemPriceMinor + vq.shippingMinor + serviceFeeMinor;

    const row = await this.quoteRepo.create({
      listingId: listing.id,
      shippingAddress: input.shippingAddress,
      partPriceMinor: vq.itemPriceMinor,
      shippingMinor: vq.shippingMinor,
      serviceFeeMinor,
      taxMinor: vq.taxMinor, // vendor tax — stored for payout reconciliation only
      totalMinor: subtotalMinor,
      currency: listing.currency,
      vendorQuoteReference: vq.vendorQuoteRef,
      expiresAt: new Date(Date.now() + this.quoteTtlMinutes * 60_000),
    });

    return {
      quoteId: row.id,
      itemPriceMinor: row.partPriceMinor,
      shippingMinor: row.shippingMinor,
      serviceFeeMinor: row.serviceFeeMinor,
      currency: row.currency,
      expiresAt: row.expiresAt.toISOString(),
    } as CheckoutQuoteResponse;
  }

  /**
   * Confirm a quote and create a payment authorization.
   * - Validates the quote exists and hasn't expired.
   * - Creates the orders row (DRAFT → PENDING_PAYMENT) + deletes the quote atomically.
   * - Calls paymentProvider.createPayment (Stripe Tax Calculation + PaymentIntent).
   * - Stores providerPaymentId on the order.
   * - Returns providerClientToken for the browser to complete payment via provider SDK.
   *
   * Pricing is read entirely from the DB quote row — client input carries no amounts.
   */
  async confirm(input: ConfirmBody): Promise<CheckoutConfirmResponse> {
    const quote = await this.quoteRepo.findById(input.quoteId);
    if (!quote) throw new QuoteExpiredError('Quote not found or already used');
    if (new Date() > quote.expiresAt) {
      await this.quoteRepo.delete(quote.id);
      throw new QuoteExpiredError('Quote has expired — please request a new quote');
    }

    // Idempotency: if we already created an order with this key, return it.
    const existing = await this.orderRepo.findByIdempotencyKey(input.idempotencyKey);
    if (existing?.paymentProviderPaymentId) {
      return {
        orderId: existing.id,
        orderLookupToken: existing.orderLookupToken,
        providerClientToken: '', // client_secret is single-use; not re-returnable after creation
      };
    }

    const listing = await this.listingRepo.findById(quote.listingId);
    if (!listing) throw new CheckoutError('Listing no longer available');

    // do transactions together to assure atomicity
    const order = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;

      // Create the order row (DRAFT) and delete the quote in a single step.
      const orderRow = await new OrderRepo(txDb).create({
        status: 'DRAFT',
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        idempotencyKey: input.idempotencyKey,
        listingId: quote.listingId,
        vendorId: listing.vendorId,
        shippingAddress: quote.shippingAddress,
        partPriceMinor: quote.partPriceMinor,
        serviceFeeMinor: quote.serviceFeeMinor,
        shippingMinor: quote.shippingMinor,
        taxMinor: quote.taxMinor,
        totalMinor: quote.totalMinor,
        currency: quote.currency,
      });

      // Delete quote on consume — absence is the "used" signal.
      await new QuoteRepo(txDb).delete(quote.id);

      // Write outbox event for order created.
      await new OutboxRepo(txDb).create({
        topic: ORDER_TOPICS.CREATED,
        aggregateId: orderRow.id,
        payload: { orderId: orderRow.id },
      });

      return orderRow;
    });

    let paymentResult: CreatePaymentResult;
    try {
      paymentResult = await this.paymentProvider.createPayment({
        orderId: order.id,
        lineItems: [
          { label: 'item', amountMinor: quote.partPriceMinor },
          { label: 'shipping', amountMinor: quote.shippingMinor },
          { label: 'service_fee', amountMinor: quote.serviceFeeMinor },
        ],
        shippingAddress: quote.shippingAddress as ShippingAddress,
        customerEmail: input.contactEmail,
        currency: quote.currency,
        idempotencyKey: `pay:${input.idempotencyKey}`,
        metadata: { orderId: order.id },
      });
    } catch (err) {
      // Payment creation failed — cancel the order row so the listing is freed.
      await this.orderRepo.updateStatus(order.id, 'DRAFT', 'CANCELLED').catch(() => undefined);
      throw err;
    }

    // After paymentResult resolves...
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const repo = new OrderRepo(txDb);

      // Store provider payment id and update status to PENDING_PAYMENT.
      await repo.setStripePayment(order.id, paymentResult.providerPaymentId);
      await repo.updateStatus(order.id, 'DRAFT', 'PENDING_PAYMENT');

      // Update the order's taxMinor and totalMinor with Stripe-computed values.
      await repo.setTaxAndTotal(order.id, paymentResult.taxMinor, paymentResult.totalMinor);

      await new OutboxRepo(txDb).create({
        topic: ORDER_TOPICS.PENDING_PAYMENT,
        aggregateId: order.id,
        payload: { orderId: order.id, paymentProviderPaymentId: paymentResult.providerPaymentId },
      });
    });

    return {
      orderId: order.id,
      orderLookupToken: order.orderLookupToken,
      providerClientToken: paymentResult.providerClientToken,
    };
  }
}

// ── Domain errors ─────────────────────────────────────────────────────────────

export class CheckoutError extends Error {
  readonly statusCode = 400;
}

export class QuoteExpiredError extends CheckoutError {}

export class NotFoundError extends Error {
  readonly statusCode = 404;
}
