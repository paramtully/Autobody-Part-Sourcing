import type { ShippingAddress } from '@domain/order/order';
import type { Currency } from '@domain/listing/currency';

// ────────────────────────────────────────────────────────────────
// Request / Result types
// ────────────────────────────────────────────────────────────────

export interface ShippingQuoteRequest {
    listingId: string;
    vendorId: string;
    partNumber: string;
    shippingAddress: ShippingAddress;
    currency: Currency;
}

export type ShippingQuoteResult =
    | { status: 'QUOTED'; shippingMinor: number; taxMinor: number; vendorQuoteRef?: string; validForMinutes: number }
    | { status: 'NOT_SUPPORTED' }
    | { status: 'ESTIMATE'; shippingMinor: number };

export interface VendorOrderRequest {
    orderId: string; // Used as idempotency key
    vendorId: string;
    listingId: string;
    partNumber: string;
    quantity: number;
    shippingAddress: ShippingAddress;
    contactEmail: string;
}

export type VendorOrderResult =
    | { status: 'CONFIRMED'; vendorOrderId: string; estimatedShipDate?: Date }
    | { status: 'PENDING'; vendorOrderId: string; expectedConfirmationMinutes?: number }
    | { status: 'REJECTED'; reason: string }
    | { status: 'ERROR'; error: string; retryable: boolean };

export type VendorOrderStatus =
    | { status: 'CONFIRMED'; estimatedShipDate?: Date }
    | { status: 'PENDING' }
    | { status: 'SHIPPED'; trackingNumber?: string }
    | { status: 'CANCELLED'; reason?: string }
    | { status: 'UNKNOWN' };

// ────────────────────────────────────────────────────────────────
// Client interface
// ────────────────────────────────────────────────────────────────

/**
 * Interface for placing orders with a vendor.
 * Each vendor ordering mode has its own implementation.
 * Completely separate from VendorInventoryClient (read-only).
 */
export interface VendorOrderClient {
    getShippingQuote(input: ShippingQuoteRequest): Promise<ShippingQuoteResult>;
    placeOrder(input: VendorOrderRequest): Promise<VendorOrderResult>;
    cancelOrder?(vendorOrderId: string): Promise<void>;
    getOrderStatus?(vendorOrderId: string): Promise<VendorOrderStatus>;
}
