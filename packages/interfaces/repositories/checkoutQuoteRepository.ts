import type { ShippingAddress, OrderPricing } from '@domain/order/order';
import type { Currency } from '@domain/listing/currency';

export interface CheckoutQuote {
    id: string;
    listingId: string;
    vendorId: string;
    shippingAddress: ShippingAddress;
    partPriceMinor: number;
    serviceFeeMinor: number;
    feePercentApplied: number;
    shippingMinor: number;
    taxMinor: number;
    totalMinor: number;
    currency: Currency;
    vendorQuoteReference: string | null;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
}

export type CreateQuoteInput = Omit<CheckoutQuote, 'id' | 'usedAt' | 'createdAt'>;

export interface CheckoutQuoteRepository {
    create(input: CreateQuoteInput): Promise<CheckoutQuote>;
    findById(id: string): Promise<CheckoutQuote | null>;
    markUsed(id: string): Promise<void>;
}
