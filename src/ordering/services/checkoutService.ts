import type { ListingRepo } from '../../db/schema/listing.repository';
import type { OrderRepo, QuoteRow } from '@repo/db/repositories/order.repository';
import type { QuoteRepo } from '@repo/db/repositories/order.repository';
import type { OutboxRepo } from '@repo/db/repositories/outbox.repository';
import type { VendorOrderClientRegistry } from '../clients/registry';
import type { ShippingAddress } from '../clients/vendorOrderClient';
import type { PaymentProviderAdapter, CreatePaymentResult } from '../payment/paymentProvider';

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
  constructor(
    private readonly listingRepo: ListingRepo,
    private readonly quoteRepo: QuoteRepo,
    private readonly orderRepo: OrderRepo,
    private readonly outboxRepo: OutboxRepo,
    private readonly vendorRegistry: VendorOrderClientRegistry,
    private readonly paymentProvider: PaymentProviderAdapter,
    private readonly feePercent: number,
    private readonly quoteTtlMinutes: number = 15,
  ) {}

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
  async createQuote(input: {
    listingId: string;
    shippingAddress: ShippingAddress;
  }): Promise<CheckoutQuoteResponse> {
    const listing = await this.listingRepo.findById(input.listingId);
    if (!listing) throw new NotFoundError(`Listing ${input.listingId} not found`);
    if (!listing.isActive) throw new CheckoutError('This listing is no longer available');

    // Block EMAIL_MANUAL vendors — auth hold window not safe for multi-day replies.
    if (listing.vendor.orderingMode === 'EMAIL_MANUAL') {
      throw new CheckoutError('Vendor not available for online ordering');
    }

    const client = this.vendorRegistry.get(listing.vendorId);
    const vq = await client.getQuote({
      listingId: listing.id,
      vendorId: listing.vendorId,
      partNumber: listing.partIdentifier.value,
      shippingAddress: input.shippingAddress,
      currency: listing.currency,
    });

    const serviceFeeMinor = Math.round(this.feePercent * (vq.itemPriceMinor + vq.shippingMinor));
    // pre-tax subtotal stored on the quote (Stripe computes final tax at confirm)
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
    };
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
  async confirm(input: {
    quoteId: string;
    contactEmail: string;
    contactPhone?: string;
    idempotencyKey: string;
  }): Promise<CheckoutConfirmResponse> {
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

    // Create the order row (DRAFT) and delete the quote in a single step.
    const order = await this.orderRepo.create({
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
    await this.quoteRepo.delete(quote.id);

    // Write outbox event for order created.
    await this.outboxRepo.create({
      topic: 'order.created',
      aggregateId: order.id,
      payload: { orderId: order.id },
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

    // Store provider payment id and update status to PENDING_PAYMENT.
    await this.orderRepo.setStripePayment(order.id, paymentResult.providerPaymentId);
    await this.orderRepo.updateStatus(order.id, 'DRAFT', 'PENDING_PAYMENT');

    // Update the order's taxMinor and totalMinor with Stripe-computed values.
    await this.orderRepo.setTaxAndTotal(
      order.id,
      paymentResult.taxMinor,
      paymentResult.totalMinor,
    );

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
