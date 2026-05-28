import type { currencyEnum } from '../../db/models/enums';

export type VendorOrderingMode = 'API_SYNC' | 'API_ASYNC' | 'EMAIL_MANUAL';

export interface ShippingAddress {
  line1: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
}

// ── Order quote ───────────────────────────────────────────────────────────────

export interface OrderQuoteRequest {
  listingId: string;
  vendorId: string;
  partNumber: string;
  shippingAddress: ShippingAddress;
  currency: typeof currencyEnum.enumValues[number];
}

/**
 * Vendor-side cost breakdown returned to the backend only.
 * taxMinor = vendor's tax on item + shipping (stored for payout reconciliation).
 * The customer never sees this directly; the backend adds serviceFee and defers
 * Stripe Tax to PaymentIntent creation.
 *
 * QUOTED  — vendor returned real-time pricing.
 * ESTIMATE — vendor has no real-time API; flat rate from vendors.flat_shipping_minor used.
 */
export interface OrderQuoteResult {
  status: 'QUOTED' | 'ESTIMATE';
  itemPriceMinor: number;
  shippingMinor: number;
  taxMinor: number;
  vendorQuoteRef?: string;
  validForMinutes?: number;
}

// ── Order placement ───────────────────────────────────────────────────────────

export interface VendorOrderRequest {
  orderId: string;
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

// ── Client interface ──────────────────────────────────────────────────────────

export interface VendorOrderClient {
  readonly vendorId: string;
  /** Metadata only — used by inbound callback handlers to route correctly. */
  readonly orderingMode: VendorOrderingMode;
  getQuote(input: OrderQuoteRequest): Promise<OrderQuoteResult>;
  placeOrder(input: VendorOrderRequest): Promise<VendorOrderResult>;
  /**
   * Parse an inbound vendor webhook body + headers into an order update.
   * Returns null on signature failure or unrecognised payload — route handler
   * should respond 401 / 400 respectively.
   * Only implemented by API_ASYNC vendors; optional for others.
   */
  parseWebhook?(
    body: unknown,
    headers: Record<string, string>,
  ): { orderId: string; result: VendorOrderResult } | null;
}
