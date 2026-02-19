import { describe, it, expect } from '@jest/globals';
import {
    OrderStatus,
    ALLOWED_TRANSITIONS,
    assertTransitionAllowed,
    InvalidTransitionError,
} from '../orderStatus';

describe('OrderStatus state machine', () => {
    describe('ALLOWED_TRANSITIONS completeness', () => {
        it('should define transitions for every OrderStatus value', () => {
            const allStatuses = Object.values(OrderStatus);
            for (const status of allStatuses) {
                expect(ALLOWED_TRANSITIONS).toHaveProperty(status);
                expect(Array.isArray(ALLOWED_TRANSITIONS[status])).toBe(true);
            }
        });
    });

    describe('assertTransitionAllowed — valid transitions', () => {
        const validTransitions: [OrderStatus, OrderStatus][] = [
            [OrderStatus.DRAFT, OrderStatus.PENDING_PAYMENT],
            [OrderStatus.DRAFT, OrderStatus.CANCELLED],
            [OrderStatus.PENDING_PAYMENT, OrderStatus.PAYMENT_AUTHORIZED],
            [OrderStatus.PENDING_PAYMENT, OrderStatus.FAILED],
            [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED],
            [OrderStatus.PAYMENT_AUTHORIZED, OrderStatus.VENDOR_ORDER_PENDING],
            [OrderStatus.PAYMENT_AUTHORIZED, OrderStatus.CANCELLED],
            [OrderStatus.VENDOR_ORDER_PENDING, OrderStatus.VENDOR_CONFIRMED],
            [OrderStatus.VENDOR_ORDER_PENDING, OrderStatus.CANCELLED],
            [OrderStatus.VENDOR_ORDER_PENDING, OrderStatus.FAILED],
            [OrderStatus.VENDOR_CONFIRMED, OrderStatus.COMPLETED],
            [OrderStatus.COMPLETED, OrderStatus.REFUNDED],
            [OrderStatus.COMPLETED, OrderStatus.PARTIALLY_REFUNDED],
            [OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED],
        ];

        it.each(validTransitions)(
            'should allow %s → %s',
            (from, to) => {
                expect(() => assertTransitionAllowed(from, to)).not.toThrow();
            },
        );
    });

    describe('assertTransitionAllowed — invalid transitions', () => {
        const invalidTransitions: [OrderStatus, OrderStatus][] = [
            // Backwards transitions
            [OrderStatus.PENDING_PAYMENT, OrderStatus.DRAFT],
            [OrderStatus.PAYMENT_AUTHORIZED, OrderStatus.PENDING_PAYMENT],
            [OrderStatus.COMPLETED, OrderStatus.VENDOR_CONFIRMED],
            // Skip transitions
            [OrderStatus.DRAFT, OrderStatus.COMPLETED],
            [OrderStatus.PENDING_PAYMENT, OrderStatus.COMPLETED],
            // Invalid from terminal states
            [OrderStatus.CANCELLED, OrderStatus.DRAFT],
            [OrderStatus.FAILED, OrderStatus.DRAFT],
            [OrderStatus.REFUNDED, OrderStatus.COMPLETED],
        ];

        it.each(invalidTransitions)(
            'should reject %s → %s',
            (from, to) => {
                expect(() => assertTransitionAllowed(from, to)).toThrow(InvalidTransitionError);
            },
        );
    });

    describe('terminal states', () => {
        const terminalStates = [OrderStatus.CANCELLED, OrderStatus.FAILED, OrderStatus.REFUNDED];

        it.each(terminalStates)(
            '%s should have no outbound transitions',
            (status) => {
                expect(ALLOWED_TRANSITIONS[status]).toEqual([]);
            },
        );
    });

    describe('PARTIALLY_REFUNDED constraints', () => {
        it('should only transition to REFUNDED', () => {
            expect(ALLOWED_TRANSITIONS[OrderStatus.PARTIALLY_REFUNDED]).toEqual([OrderStatus.REFUNDED]);
        });
    });

    describe('self-transition', () => {
        it('should reject transition to same status', () => {
            expect(() => assertTransitionAllowed(OrderStatus.DRAFT, OrderStatus.DRAFT)).toThrow(
                InvalidTransitionError,
            );
        });
    });

    describe('InvalidTransitionError', () => {
        it('should include from and to status in message', () => {
            try {
                assertTransitionAllowed(OrderStatus.CANCELLED, OrderStatus.COMPLETED);
                fail('Should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(InvalidTransitionError);
                const error = err as InvalidTransitionError;
                expect(error.fromStatus).toBe(OrderStatus.CANCELLED);
                expect(error.toStatus).toBe(OrderStatus.COMPLETED);
                expect(error.message).toContain('CANCELLED');
                expect(error.message).toContain('COMPLETED');
            }
        });
    });
});
