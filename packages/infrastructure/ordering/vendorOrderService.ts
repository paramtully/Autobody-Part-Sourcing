import type { Order } from '@domain/order/order';
import { OrderStatus } from '@domain/order/orderStatus';
import { VendorOrderingMode } from '@domain/order/vendorOrderingMode';
import type { VendorOrderClient, VendorOrderResult } from '../vendorOrdering/vendorOrderClient';
import { VendorOrderClientRegistry, NoClientRegisteredError } from '../vendorOrdering/vendorOrderClientRegistry';
import { OrderService } from './orderService';
import { PaymentService } from './paymentService';
import type { OrderRepository } from '@interfaces/repositories/orderRepository';
import type { DistributedLockService } from '@interfaces/services/distributedLockService';
import type { ListingHoldRepository } from './checkoutService';

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Handles placing orders with vendors after payment authorization.
 * Delegates to the appropriate VendorOrderClient via the registry.
 */
export class VendorOrderService {
    constructor(
        private readonly registry: VendorOrderClientRegistry,
        private readonly orderService: OrderService,
        private readonly orderRepo: OrderRepository,
        private readonly paymentService: PaymentService,
        private readonly lockService: DistributedLockService,
        private readonly holdRepo: ListingHoldRepository,
        private readonly emailService?: EmailService,
    ) {}

    /**
     * Place an order with the vendor. Called by the Kafka consumer
     * on `order.payment_authorized`.
     */
    async placeOrder(orderId: string): Promise<void> {
        const lock = await this.lockService.acquireLock(
            `lock:order:${orderId}:vendor_place`,
            30_000,
        );

        try {
            const order = await this.orderRepo.findById(orderId);
            if (!order) throw new Error(`Order ${orderId} not found`);

            // Idempotent: skip if already past PAYMENT_AUTHORIZED
            if (order.status !== OrderStatus.PAYMENT_AUTHORIZED) return;

            const client = this.registry.getClient(order.vendorOrderingMode);

            // Special handling for EMAIL_MANUAL
            if (order.vendorOrderingMode === VendorOrderingMode.EMAIL_MANUAL) {
                await this.handleEmailManual(order, client);
                return;
            }

            // API-based ordering with retry
            let lastResult: VendorOrderResult | null = null;

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                const result = await client.placeOrder({
                    orderId: order.id,
                    vendorId: order.vendorId,
                    listingId: order.listingId,
                    partNumber: order.snapshot.partNumber,
                    quantity: 1,
                    shippingAddress: order.shippingAddress,
                    contactEmail: order.contactEmail,
                });

                lastResult = result;

                switch (result.status) {
                    case 'CONFIRMED':
                        await this.orderRepo.update(orderId, {
                            vendorOrderId: result.vendorOrderId,
                            vendorOrderConfirmedAt: new Date(),
                            vendorOrderPlacedAt: new Date(),
                        });
                        await this.orderService.transition(
                            orderId,
                            OrderStatus.PAYMENT_AUTHORIZED,
                            OrderStatus.VENDOR_CONFIRMED,
                            { reason: `Vendor confirmed order ${result.vendorOrderId}` },
                        );
                        return;

                    case 'PENDING':
                        await this.orderRepo.update(orderId, {
                            vendorOrderId: result.vendorOrderId,
                            vendorOrderPlacedAt: new Date(),
                        });
                        await this.orderService.transition(
                            orderId,
                            OrderStatus.PAYMENT_AUTHORIZED,
                            OrderStatus.VENDOR_ORDER_PENDING,
                            { reason: `Waiting for vendor confirmation (${result.expectedConfirmationMinutes ?? '?'}min)` },
                        );
                        return;

                    case 'REJECTED':
                        await this.paymentService.cancel(orderId);
                        await this.holdRepo.releaseHold(orderId);
                        await this.orderService.transition(
                            orderId,
                            OrderStatus.PAYMENT_AUTHORIZED,
                            OrderStatus.CANCELLED,
                            { reason: `Vendor rejected: ${result.reason}` },
                        );
                        return;

                    case 'ERROR':
                        if (!result.retryable || attempt === MAX_RETRIES) {
                            break; // Fall through to terminal failure
                        }
                        // Wait before retry
                        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
                        await new Promise((resolve) => setTimeout(resolve, delay));
                        continue;
                }

                // Terminal error
                break;
            }

            // Terminal failure after retries exhausted
            await this.paymentService.cancel(orderId);
            await this.holdRepo.releaseHold(orderId);
            await this.orderService.transition(
                orderId,
                OrderStatus.PAYMENT_AUTHORIZED,
                OrderStatus.FAILED,
                { reason: `Vendor order failed: ${(lastResult as any)?.error ?? 'unknown'}` },
            );
        } finally {
            await this.lockService.releaseLock(lock);
        }
    }

    private async handleEmailManual(order: Order, client: VendorOrderClient): Promise<void> {
        try {
            // Use client.placeOrder to send email via the client impl
            const result = await client.placeOrder({
                orderId: order.id,
                vendorId: order.vendorId,
                listingId: order.listingId,
                partNumber: order.snapshot.partNumber,
                quantity: 1,
                shippingAddress: order.shippingAddress,
                contactEmail: order.contactEmail,
            });

            if (result.status === 'PENDING') {
                await this.orderRepo.update(order.id, {
                    vendorOrderId: result.vendorOrderId,
                    vendorOrderPlacedAt: new Date(),
                });
                await this.orderService.transition(
                    order.id,
                    OrderStatus.PAYMENT_AUTHORIZED,
                    OrderStatus.VENDOR_ORDER_PENDING,
                    { reason: 'Order email sent to vendor; awaiting reply' },
                );
            } else if (result.status === 'ERROR') {
                throw new Error(result.error);
            }
        } catch (err) {
            await this.paymentService.cancel(order.id);
            await this.holdRepo.releaseHold(order.id);
            await this.orderService.transition(
                order.id,
                OrderStatus.PAYMENT_AUTHORIZED,
                OrderStatus.FAILED,
                { reason: `EMAIL_MANUAL order failed: ${(err as Error).message}` },
            );
        }
    }
}

/**
 * Minimal email service interface used by VendorOrderService.
 */
export interface EmailService {
    sendOrderToVendor(input: {
        orderId: string;
        vendorEmail: string;
        replyToAddress: string;
        body: string;
    }): Promise<void>;
}
