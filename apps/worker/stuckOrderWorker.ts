import { OrderStatus } from '@domain/order/orderStatus';
import { VendorOrderingMode } from '@domain/order/vendorOrderingMode';
import type { Order } from '@domain/order/order';
import type { OrderRepository } from '@interfaces/repositories/orderRepository';

// ────────────────────────────────────────────────────────────────
// Dependency interfaces (injected)
// ────────────────────────────────────────────────────────────────

/** Subset of OrderService needed by the worker */
interface OrderTransitioner {
    transition(
        orderId: string,
        expectedStatus: OrderStatus,
        newStatus: OrderStatus,
        opts?: { reason?: string; actor?: string },
    ): Promise<Order>;
}

/** Subset of PaymentService needed by the worker */
interface PaymentCanceller {
    cancel(orderId: string): Promise<void>;
}

/** Listing hold release */
interface HoldReleaser {
    releaseHold(orderId: string): Promise<void>;
}

/** Vendor status polling */
interface VendorStatusPoller {
    hasClient(mode: VendorOrderingMode): boolean;
    getOrderStatus(mode: VendorOrderingMode, vendorOrderId: string): Promise<
        | { status: 'CONFIRMED' }
        | { status: 'CANCELLED'; reason?: string }
        | { status: 'PENDING' }
        | { status: 'UNKNOWN' }
    >;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * 24 * ONE_HOUR_MS;

// ────────────────────────────────────────────────────────────────
// Worker
// ────────────────────────────────────────────────────────────────

/**
 * Background worker that detects and resolves stuck orders.
 * Runs hourly (configured by the scheduler).
 *
 * Rules:
 * 1. PENDING_PAYMENT > 1 hour → CANCELLED (payment never authorized)
 * 2. VENDOR_ORDER_PENDING > 48 hours → poll vendor if supported, else alert
 * 3. VENDOR_ORDER_PENDING > 7 days → auto-cancel regardless of mode
 */
export class StuckOrderWorker {
    constructor(
        private readonly orderRepo: OrderRepository,
        private readonly orderTransitioner: OrderTransitioner,
        private readonly paymentCanceller: PaymentCanceller,
        private readonly holdReleaser: HoldReleaser,
        private readonly vendorPoller: VendorStatusPoller,
    ) {}

    async run(): Promise<void> {
        await this.handleStuckPendingPayment();
        await this.handleStuckVendorOrderPending();
    }

    /**
     * PENDING_PAYMENT for > 1 hour → Cancel
     */
    private async handleStuckPendingPayment(): Promise<void> {
        const stuck = await this.orderRepo.findStuckOrders(
            OrderStatus.PENDING_PAYMENT,
            ONE_HOUR_MS,
        );

        for (const order of stuck) {
            try {
                await this.paymentCanceller.cancel(order.id);
                await this.holdReleaser.releaseHold(order.id);
                await this.orderTransitioner.transition(
                    order.id,
                    OrderStatus.PENDING_PAYMENT,
                    OrderStatus.CANCELLED,
                    { reason: 'Payment never authorized (timeout)', actor: 'system' },
                );
            } catch (err) {
                console.error(
                    `[StuckOrderWorker] Failed to cancel stuck PENDING_PAYMENT order ${order.id}:`,
                    err,
                );
            }
        }
    }

    /**
     * VENDOR_ORDER_PENDING handling:
     * - > 48h with status lookup support → poll vendor
     * - > 48h EMAIL_MANUAL → alert admin (log)
     * - > 7 days any mode → auto-cancel
     */
    private async handleStuckVendorOrderPending(): Promise<void> {
        const stuckOrders = await this.orderRepo.findStuckOrders(
            OrderStatus.VENDOR_ORDER_PENDING,
            FORTY_EIGHT_HOURS_MS,
        );

        for (const order of stuckOrders) {
            try {
                const orderAge = Date.now() - order.updatedAt.getTime();

                // Auto-cancel after 7 days regardless of mode
                if (orderAge >= SEVEN_DAYS_MS) {
                    await this.paymentCanceller.cancel(order.id);
                    await this.holdReleaser.releaseHold(order.id);
                    await this.orderTransitioner.transition(
                        order.id,
                        OrderStatus.VENDOR_ORDER_PENDING,
                        OrderStatus.CANCELLED,
                        { reason: 'Vendor order unconfirmed for 7 days (auto-cancel)', actor: 'system' },
                    );
                    continue;
                }

                // Try status lookup if vendor supports it
                if (
                    order.vendorOrderId &&
                    this.vendorPoller.hasClient(order.vendorOrderingMode)
                ) {
                    const vendorStatus = await this.vendorPoller.getOrderStatus(
                        order.vendorOrderingMode,
                        order.vendorOrderId,
                    );

                    if (vendorStatus.status === 'CONFIRMED') {
                        await this.orderTransitioner.transition(
                            order.id,
                            OrderStatus.VENDOR_ORDER_PENDING,
                            OrderStatus.VENDOR_CONFIRMED,
                            { reason: 'Vendor confirmed (polled by stuck order worker)', actor: 'system' },
                        );
                    } else if (vendorStatus.status === 'CANCELLED') {
                        await this.paymentCanceller.cancel(order.id);
                        await this.holdReleaser.releaseHold(order.id);
                        await this.orderTransitioner.transition(
                            order.id,
                            OrderStatus.VENDOR_ORDER_PENDING,
                            OrderStatus.CANCELLED,
                            { reason: `Vendor cancelled: ${vendorStatus.reason ?? 'unknown'}`, actor: 'system' },
                        );
                    }
                    // PENDING or UNKNOWN → no action, wait for next run
                    continue;
                }

                // EMAIL_MANUAL — log alert for admin
                if (order.vendorOrderingMode === VendorOrderingMode.EMAIL_MANUAL) {
                    console.warn(
                        `[StuckOrderWorker] EMAIL_MANUAL order ${order.id} stuck in VENDOR_ORDER_PENDING for >48h. Admin review required.`,
                    );
                }
            } catch (err) {
                console.error(
                    `[StuckOrderWorker] Failed to process stuck order ${order.id}:`,
                    err,
                );
            }
        }
    }
}
