export enum OrderStatus {
    DRAFT = 'DRAFT',
    PENDING_PAYMENT = 'PENDING_PAYMENT',
    PAYMENT_AUTHORIZED = 'PAYMENT_AUTHORIZED',
    VENDOR_ORDER_PENDING = 'VENDOR_ORDER_PENDING',
    VENDOR_CONFIRMED = 'VENDOR_CONFIRMED',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
    FAILED = 'FAILED',
    REFUNDED = 'REFUNDED',
    PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

/**
 * Defines all legal state transitions for orders.
 * Any transition not in this map is illegal and will be rejected.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.DRAFT]: [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED],
    [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAYMENT_AUTHORIZED, OrderStatus.FAILED, OrderStatus.CANCELLED],
    [OrderStatus.PAYMENT_AUTHORIZED]: [OrderStatus.VENDOR_ORDER_PENDING, OrderStatus.CANCELLED],
    [OrderStatus.VENDOR_ORDER_PENDING]: [OrderStatus.VENDOR_CONFIRMED, OrderStatus.CANCELLED, OrderStatus.FAILED],
    [OrderStatus.VENDOR_CONFIRMED]: [OrderStatus.COMPLETED],
    [OrderStatus.COMPLETED]: [OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED],
    [OrderStatus.CANCELLED]: [],
    [OrderStatus.FAILED]: [],
    [OrderStatus.REFUNDED]: [],
    [OrderStatus.PARTIALLY_REFUNDED]: [OrderStatus.REFUNDED],
};

/**
 * Error thrown when an illegal state transition is attempted.
 */
export class InvalidTransitionError extends Error {
    constructor(
        public readonly fromStatus: OrderStatus,
        public readonly toStatus: OrderStatus,
    ) {
        super(`Invalid order transition: ${fromStatus} → ${toStatus}`);
        this.name = 'InvalidTransitionError';
    }
}

/**
 * Error thrown when an optimistic concurrency check fails (row was already changed).
 */
export class StaleOrderError extends Error {
    constructor(
        public readonly orderId: string,
        public readonly expectedStatus: OrderStatus,
    ) {
        super(`Order ${orderId} is no longer in status ${expectedStatus} (stale write)`);
        this.name = 'StaleOrderError';
    }
}

/**
 * Validates whether a state transition is allowed.
 * @throws InvalidTransitionError if the transition is not in ALLOWED_TRANSITIONS
 */
export function assertTransitionAllowed(from: OrderStatus, to: OrderStatus): void {
    if (from === to) {
        throw new InvalidTransitionError(from, to);
    }
    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed.includes(to)) {
        throw new InvalidTransitionError(from, to);
    }
}
