import type { Order, ShippingAddress, ListingSnapshot, OrderPricing } from '@domain/order/order';
import type { OrderStatus } from '@domain/order/orderStatus';
import type { VendorOrderingMode } from '@domain/order/vendorOrderingMode';
import type { Currency } from '@domain/listing/currency';
import type { PartCondition } from '@domain/listing/partCondition';

/**
 * Raw row shape from the `orders` table (drizzle select result).
 */
export interface OrderRow {
    id: string;
    orderNumber: string;
    status: string;
    userId: string | null;
    contactEmail: string;
    contactPhone: string | null;
    orderLookupToken: string;
    idempotencyKey: string;
    quoteId: string | null;
    listingId: string;
    vendorId: string;
    shippingAddress: unknown;
    snapshotPartName: string | null;
    snapshotPartNumber: string | null;
    snapshotCondition: string | null;
    snapshotVendorName: string | null;
    snapshotListingPriceMinor: number | null;
    snapshotCurrency: string | null;
    partPriceMinor: number;
    serviceFeeMinor: number;
    feePercentApplied: string; // numeric comes back as string from pg
    shippingMinor: number;
    taxMinor: number;
    totalMinor: number;
    currency: string;
    totalRefundedMinor: number;
    vendorOrderId: string | null;
    vendorOrderingMode: string;
    vendorOrderPlacedAt: Date | null;
    vendorOrderConfirmedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Maps a raw `orders` DB row to the `Order` domain model.
 */
export function toDomainOrder(row: OrderRow): Order {
    const snapshot: ListingSnapshot = {
        partName: row.snapshotPartName ?? '',
        partNumber: row.snapshotPartNumber ?? '',
        condition: (row.snapshotCondition as PartCondition) ?? 'UNKNOWN',
        vendorName: row.snapshotVendorName ?? '',
        listingPriceMinor: row.snapshotListingPriceMinor ?? 0,
        currency: (row.snapshotCurrency as Currency) ?? 'USD',
    };

    const pricing: OrderPricing = {
        partPriceMinor: row.partPriceMinor,
        serviceFeeMinor: row.serviceFeeMinor,
        feePercentApplied: parseFloat(row.feePercentApplied),
        shippingMinor: row.shippingMinor,
        taxMinor: row.taxMinor,
        totalMinor: row.totalMinor,
        currency: row.currency as Currency,
    };

    return {
        id: row.id,
        orderNumber: row.orderNumber,
        status: row.status as OrderStatus,
        userId: row.userId,
        contactEmail: row.contactEmail,
        contactPhone: row.contactPhone,
        orderLookupToken: row.orderLookupToken,
        idempotencyKey: row.idempotencyKey,
        quoteId: row.quoteId,
        listingId: row.listingId,
        vendorId: row.vendorId,
        shippingAddress: row.shippingAddress as ShippingAddress,
        snapshot,
        pricing,
        totalRefundedMinor: row.totalRefundedMinor,
        vendorOrderId: row.vendorOrderId,
        vendorOrderingMode: row.vendorOrderingMode as VendorOrderingMode,
        vendorOrderPlacedAt: row.vendorOrderPlacedAt,
        vendorOrderConfirmedAt: row.vendorOrderConfirmedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
