import { OrderStatus } from './orderStatus';
import { VendorOrderingMode } from './vendorOrderingMode';
import { Currency } from '../listing/currency';
import { PartCondition } from '../listing/partCondition';

/**
 * Minimum charge in minor units (cents). Orders below this cannot reach payment.
 * Stripe minimum is $0.50 USD; we use $1.00 for safety.
 */
export const PLATFORM_MINIMUM_CHARGE_MINOR = 100;

// ────────────────────────────────────────────────────────────────
// Shipping Address
// ────────────────────────────────────────────────────────────────

export interface ShippingAddress {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string; // ISO 3166-1 alpha-2
}

// ────────────────────────────────────────────────────────────────
// Listing Snapshot — frozen at checkout time
// ────────────────────────────────────────────────────────────────

export interface ListingSnapshot {
    partName: string;
    partNumber: string;
    condition: PartCondition;
    vendorName: string;
    listingPriceMinor: number;
    currency: Currency;
}

// ────────────────────────────────────────────────────────────────
// Order Pricing — immutable after order creation
// ────────────────────────────────────────────────────────────────

export interface OrderPricing {
    partPriceMinor: number;
    serviceFeeMinor: number;
    feePercentApplied: number; // e.g. 0.03
    shippingMinor: number;
    taxMinor: number;
    totalMinor: number;
    currency: Currency;
}

// ────────────────────────────────────────────────────────────────
// Order — aggregate root
// ────────────────────────────────────────────────────────────────

export interface Order {
    id: string;
    orderNumber: string;
    status: OrderStatus;

    // Identity
    userId: string | null;
    contactEmail: string;
    contactPhone: string | null;
    orderLookupToken: string;
    idempotencyKey: string;

    // References
    quoteId: string | null;
    listingId: string;
    vendorId: string;

    // Shipping
    shippingAddress: ShippingAddress;

    // Snapshot
    snapshot: ListingSnapshot;

    // Pricing
    pricing: OrderPricing;

    // Refund tracking
    totalRefundedMinor: number;

    // Vendor order tracking
    vendorOrderId: string | null;
    vendorOrderingMode: VendorOrderingMode;
    vendorOrderPlacedAt: Date | null;
    vendorOrderConfirmedAt: Date | null;

    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

// ────────────────────────────────────────────────────────────────
// Pricing computation — pure function
// ────────────────────────────────────────────────────────────────

export interface ComputePricingInput {
    partPriceMinor: number;
    feePercent: number;
    shippingMinor: number;
    taxMinor: number;
    currency: Currency;
}

/**
 * Computes order pricing from inputs. Pure function — no side effects.
 * @throws Error if total is below PLATFORM_MINIMUM_CHARGE_MINOR
 * @throws Error if total !== partPrice + fee + shipping + tax
 */
export function computeOrderPricing(input: ComputePricingInput): OrderPricing {
    const { partPriceMinor, feePercent, shippingMinor, taxMinor, currency } = input;

    const serviceFeeMinor = Math.round(partPriceMinor * feePercent);
    const totalMinor = partPriceMinor + serviceFeeMinor + shippingMinor + taxMinor;

    if (totalMinor < PLATFORM_MINIMUM_CHARGE_MINOR) {
        throw new Error(
            `Order total ${totalMinor} is below platform minimum charge of ${PLATFORM_MINIMUM_CHARGE_MINOR} minor units`,
        );
    }

    const pricing: OrderPricing = {
        partPriceMinor,
        serviceFeeMinor,
        feePercentApplied: feePercent,
        shippingMinor,
        taxMinor,
        totalMinor,
        currency,
    };

    // Invariant: total must equal sum of components
    const expectedTotal = partPriceMinor + serviceFeeMinor + shippingMinor + taxMinor;
    if (pricing.totalMinor !== expectedTotal) {
        throw new Error(
            `Total integrity violation: ${pricing.totalMinor} !== ${expectedTotal}`,
        );
    }

    return pricing;
}
