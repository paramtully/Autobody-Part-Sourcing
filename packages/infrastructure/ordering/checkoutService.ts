import { randomBytes } from 'crypto';
import type { Order, ShippingAddress, ListingSnapshot } from '@domain/order/order';
import { computeOrderPricing, PLATFORM_MINIMUM_CHARGE_MINOR } from '@domain/order/order';
import { OrderStatus } from '@domain/order/orderStatus';
import { VendorOrderingMode } from '@domain/order/vendorOrderingMode';
import type { Currency } from '@domain/listing/currency';
import type { OrderRepository, CreateOrderInput } from '@interfaces/repositories/orderRepository';
import type { CheckoutQuoteRepository, CheckoutQuote } from '@interfaces/repositories/checkoutQuoteRepository';
import type { OutboxRepository } from '@interfaces/repositories/outboxRepository';
import type { FeeConfigurationService } from '@interfaces/services/feeConfigurationService';
import type { DistributedLockService } from '@interfaces/services/distributedLockService';
import type { VendorOrderClient, ShippingQuoteResult } from '../vendorOrdering/vendorOrderClient';
import { PaymentService } from './paymentService';

// ────────────────────────────────────────────────────────────────
// Custom errors
// ────────────────────────────────────────────────────────────────

export class ListingUnavailableError extends Error {
    constructor(public readonly listingId: string) {
        super(`Listing ${listingId} is not available for purchase`);
        this.name = 'ListingUnavailableError';
    }
}

export class VendorNotSupportedError extends Error {
    constructor(public readonly vendorId: string) {
        super(`Vendor ${vendorId} does not support ordering`);
        this.name = 'VendorNotSupportedError';
    }
}

export class QuoteExpiredError extends Error {
    constructor(public readonly quoteId: string) {
        super(`Checkout quote ${quoteId} has expired`);
        this.name = 'QuoteExpiredError';
    }
}

export class QuoteAlreadyUsedError extends Error {
    constructor(public readonly quoteId: string) {
        super(`Checkout quote ${quoteId} has already been used`);
        this.name = 'QuoteAlreadyUsedError';
    }
}

export class ListingHoldConflictError extends Error {
    constructor(public readonly listingId: string) {
        super(`Listing ${listingId} is temporarily held by another order`);
        this.name = 'ListingHoldConflictError';
    }
}

// ────────────────────────────────────────────────────────────────
// Dependencies (injected interfaces for things we read)
// ────────────────────────────────────────────────────────────────

/** Minimal listing data needed for checkout */
export interface ListingForCheckout {
    id: string;
    vendorId: string;
    isActive: boolean;
    priceMinorMin: number;
    currency: Currency;
    condition: string;
    description?: string;
    // Snapshot fields
    partName: string;
    partNumber: string;
    vendorName: string;
}

/** Minimal listing-hold repo used by checkout */
export interface ListingHoldRepository {
    findActiveHold(listingId: string): Promise<{ id: string; orderId: string; expiresAt: Date } | null>;
    createHold(listingId: string, orderId: string, expiresAt: Date): Promise<void>;
    releaseHold(orderId: string): Promise<void>;
}

/**
 * Reads listing data. Checkout only needs `findById` and vendor metadata.
 */
export interface ListingReader {
    findById(id: string): Promise<ListingForCheckout | null>;
    getVendorOrderingMode(vendorId: string): Promise<VendorOrderingMode>;
}

// ────────────────────────────────────────────────────────────────
// Checkout service — two-phase: Quote → Confirm
// ────────────────────────────────────────────────────────────────

export interface QuoteResult {
    quoteId: string;
    partPriceMinor: number;
    serviceFeeMinor: number;
    feePercentApplied: number;
    shippingMinor: number;
    taxMinor: number;
    totalMinor: number;
    currency: Currency;
    expiresAt: Date;
}

export interface ConfirmResult {
    orderId: string;
    orderNumber: string;
    orderLookupToken: string;
    clientSecret: string;
}

const QUOTE_TTL_MINUTES = 15;
const HOLD_TTL_MINUTES = 20;

export class CheckoutService {
    constructor(
        private readonly listingReader: ListingReader,
        private readonly feeConfigService: FeeConfigurationService,
        private readonly vendorOrderClient: VendorOrderClient,
        private readonly quoteRepo: CheckoutQuoteRepository,
        private readonly orderRepo: OrderRepository,
        private readonly holdRepo: ListingHoldRepository,
        private readonly outboxRepo: OutboxRepository,
        private readonly paymentService: PaymentService,
        private readonly lockService: DistributedLockService,
    ) {}

    /**
     * PHASE 1 — Quote: compute pricing incl. shipping, store a quote.
     */
    async getQuote(input: {
        listingId: string;
        shippingAddress: ShippingAddress;
    }): Promise<QuoteResult> {
        // 1. Fetch listing
        const listing = await this.listingReader.findById(input.listingId);
        if (!listing || !listing.isActive) {
            throw new ListingUnavailableError(input.listingId);
        }

        // 2. Check vendor ordering mode
        const orderingMode = await this.listingReader.getVendorOrderingMode(listing.vendorId);
        if (orderingMode === VendorOrderingMode.NOT_SUPPORTED) {
            throw new VendorNotSupportedError(listing.vendorId);
        }

        // 3. Get current fee
        const feePercent = await this.feeConfigService.getCurrentFeePercent();

        // 4. Get shipping quote from vendor
        const shippingResult = await this.vendorOrderClient.getShippingQuote({
            listingId: listing.id,
            vendorId: listing.vendorId,
            partNumber: listing.partNumber,
            shippingAddress: input.shippingAddress,
            currency: listing.currency,
        });

        if (shippingResult.status === 'NOT_SUPPORTED') {
            throw new VendorNotSupportedError(listing.vendorId);
        }

        const shippingMinor = shippingResult.shippingMinor;
        const taxMinor = shippingResult.status === 'QUOTED' ? shippingResult.taxMinor : 0;

        // 5. Compute pricing
        const pricing = computeOrderPricing({
            partPriceMinor: listing.priceMinorMin,
            feePercent,
            shippingMinor,
            taxMinor,
            currency: listing.currency,
        });

        // 6. Store quote
        const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60 * 1000);
        const quote = await this.quoteRepo.create({
            listingId: listing.id,
            vendorId: listing.vendorId,
            shippingAddress: input.shippingAddress,
            partPriceMinor: pricing.partPriceMinor,
            serviceFeeMinor: pricing.serviceFeeMinor,
            feePercentApplied: pricing.feePercentApplied,
            shippingMinor: pricing.shippingMinor,
            taxMinor: pricing.taxMinor,
            totalMinor: pricing.totalMinor,
            currency: pricing.currency,
            vendorQuoteReference: shippingResult.status === 'QUOTED' ? (shippingResult.vendorQuoteRef ?? null) : null,
            expiresAt,
        });

        return {
            quoteId: quote.id,
            ...pricing,
            expiresAt,
        };
    }

    /**
     * PHASE 2 — Confirm: validate quote, create order, acquire listing hold,
     * create payment intent, return client secret.
     */
    async confirm(input: {
        quoteId: string;
        contactEmail: string;
        contactPhone?: string;
        idempotencyKey: string;
    }): Promise<ConfirmResult> {
        // 1. Idempotency check
        const existingOrder = await this.orderRepo.findByIdempotencyKey(input.idempotencyKey);
        if (existingOrder) {
            // Return existing order — no-op
            // Note: clientSecret should be persisted or re-fetched in real impl
            return {
                orderId: existingOrder.id,
                orderNumber: existingOrder.orderNumber,
                orderLookupToken: existingOrder.orderLookupToken,
                clientSecret: '', // Would need to retrieve from payment record
            };
        }

        // 2. Load and validate quote
        const quote = await this.quoteRepo.findById(input.quoteId);
        if (!quote) throw new QuoteExpiredError(input.quoteId);
        if (quote.expiresAt < new Date()) throw new QuoteExpiredError(input.quoteId);
        if (quote.usedAt) throw new QuoteAlreadyUsedError(input.quoteId);

        // 3. Re-validate listing is still active
        const listing = await this.listingReader.findById(quote.listingId);
        if (!listing || !listing.isActive) {
            throw new ListingUnavailableError(quote.listingId);
        }

        // 4. Acquire listing hold with distributed lock
        const lock = await this.lockService.acquireLock(
            `lock:listing:${quote.listingId}:hold`,
            5_000,
        );

        let orderId: string;
        let orderNumber: string;
        let orderLookupToken: string;

        try {
            // Check for existing active hold
            const existingHold = await this.holdRepo.findActiveHold(quote.listingId);
            if (existingHold && existingHold.expiresAt > new Date()) {
                throw new ListingHoldConflictError(quote.listingId);
            }

            const orderingMode = await this.listingReader.getVendorOrderingMode(quote.vendorId);

            // Create snapshot
            const snapshot: ListingSnapshot = {
                partName: listing.partName,
                partNumber: listing.partNumber,
                condition: listing.condition as any,
                vendorName: listing.vendorName,
                listingPriceMinor: listing.priceMinorMin,
                currency: listing.currency,
            };

            orderLookupToken = randomBytes(32).toString('hex');

            // Create order
            const order = await this.orderRepo.create({
                status: OrderStatus.DRAFT,
                userId: null,
                contactEmail: input.contactEmail,
                contactPhone: input.contactPhone ?? null,
                orderLookupToken,
                idempotencyKey: input.idempotencyKey,
                quoteId: quote.id,
                listingId: quote.listingId,
                vendorId: quote.vendorId,
                shippingAddress: quote.shippingAddress as ShippingAddress,
                snapshot,
                pricing: {
                    partPriceMinor: quote.partPriceMinor,
                    serviceFeeMinor: quote.serviceFeeMinor,
                    feePercentApplied: quote.feePercentApplied,
                    shippingMinor: quote.shippingMinor,
                    taxMinor: quote.taxMinor,
                    totalMinor: quote.totalMinor,
                    currency: quote.currency,
                },
                totalRefundedMinor: 0,
                vendorOrderId: null,
                vendorOrderingMode: orderingMode,
                vendorOrderPlacedAt: null,
                vendorOrderConfirmedAt: null,
            });

            orderId = order.id;
            orderNumber = order.orderNumber;

            // Insert listing hold
            const holdExpiresAt = new Date(Date.now() + HOLD_TTL_MINUTES * 60 * 1000);
            await this.holdRepo.createHold(quote.listingId, orderId, holdExpiresAt);

            // Mark quote as used
            await this.quoteRepo.markUsed(quote.id);

            // Write outbox event
            await this.outboxRepo.create({
                topic: 'order.created',
                aggregateType: 'order',
                aggregateId: orderId,
                payload: { orderId, orderNumber, status: OrderStatus.DRAFT },
            });
        } finally {
            await this.lockService.releaseLock(lock);
        }

        // 5. Create payment intent (outside listing lock scope)
        const paymentResult = await this.paymentService.createPaymentIntent({
            orderId,
            amountMinor: quote.totalMinor,
            currency: quote.currency,
            idempotencyKey: `payment-${input.idempotencyKey}`,
        });

        // 6. Transition to PENDING_PAYMENT
        await this.orderRepo.updateStatus(orderId, OrderStatus.DRAFT, OrderStatus.PENDING_PAYMENT);

        await this.outboxRepo.create({
            topic: 'order.status_changed',
            aggregateType: 'order',
            aggregateId: orderId,
            payload: {
                orderId,
                fromStatus: OrderStatus.DRAFT,
                toStatus: OrderStatus.PENDING_PAYMENT,
            },
        });

        return {
            orderId,
            orderNumber,
            orderLookupToken,
            clientSecret: paymentResult.clientSecret,
        };
    }
}
