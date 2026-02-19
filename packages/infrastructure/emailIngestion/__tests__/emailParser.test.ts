import { describe, it, expect } from '@jest/globals';
import {
    extractOrderIdFromAddress,
    classifyEmailStatus,
    extractTrackingNumber,
    parseInboundEmail,
} from '../emailParser';

describe('extractOrderIdFromAddress', () => {
    it('should extract UUID from valid orders+ address', () => {
        const orderId = extractOrderIdFromAddress(
            'orders+a1b2c3d4-e5f6-7890-abcd-ef1234567890@mail.platform.com',
        );
        expect(orderId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    it('should return null for non-orders address', () => {
        expect(extractOrderIdFromAddress('support@platform.com')).toBeNull();
    });

    it('should return null for malformed UUID', () => {
        expect(extractOrderIdFromAddress('orders+not-a-uuid@mail.platform.com')).toBeNull();
    });

    it('should return null for empty string', () => {
        expect(extractOrderIdFromAddress('')).toBeNull();
    });
});

describe('classifyEmailStatus', () => {
    it('should classify confirmation subject', () => {
        expect(classifyEmailStatus('Order Confirmed #12345', '')).toBe('CONFIRMED');
    });

    it('should classify confirmation in body', () => {
        expect(classifyEmailStatus('Re: Parts', 'We confirm your order and will ship today.')).toBe(
            'CONFIRMED',
        );
    });

    it('should classify rejection subject', () => {
        expect(classifyEmailStatus('Unable to fulfill order', '')).toBe('REJECTED');
    });

    it('should classify rejection in body', () => {
        expect(
            classifyEmailStatus('Re: Order request', 'Unfortunately the item is out of stock.'),
        ).toBe('REJECTED');
    });

    it('should classify ambiguous email as INFO', () => {
        expect(
            classifyEmailStatus('Question about your order', 'Please call us at 555-1234.'),
        ).toBe('INFO');
    });

    it('should prioritize REJECTED over CONFIRMED when both keywords present', () => {
        // REJECTED keywords are checked first
        expect(
            classifyEmailStatus(
                'Confirmation',
                'Your order has been cancelled. We cannot process it.',
            ),
        ).toBe('REJECTED');
    });

    it('should be case-insensitive', () => {
        expect(classifyEmailStatus('ORDER CONFIRMED', '')).toBe('CONFIRMED');
        expect(classifyEmailStatus('UNABLE TO FULFILL', '')).toBe('REJECTED');
    });
});

describe('extractTrackingNumber', () => {
    it('should extract UPS tracking number', () => {
        const result = extractTrackingNumber('Your tracking: 1Z9999999999999999');
        expect(result).toBe('1Z9999999999999999');
    });

    it('should extract FedEx 12-digit tracking number', () => {
        const result = extractTrackingNumber('FedEx tracking: 123456789012');
        expect(result).toBe('123456789012');
    });

    it('should return null when no tracking number found', () => {
        expect(extractTrackingNumber('Thank you for your order.')).toBeNull();
    });
});

describe('parseInboundEmail', () => {
    it('should parse a complete confirmed email', () => {
        const result = parseInboundEmail({
            toAddress: 'orders+a1b2c3d4-e5f6-7890-abcd-ef1234567890@mail.platform.com',
            subject: 'Order Confirmed',
            body: 'Your order has been confirmed. Tracking: 1Z9999999999999999',
        });

        expect(result).toEqual({
            orderId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            status: 'CONFIRMED',
            trackingNumber: '1Z9999999999999999',
        });
    });

    it('should handle email with no extractable data', () => {
        const result = parseInboundEmail({
            toAddress: 'random@vendor.com',
            subject: 'Hello',
            body: 'Just checking in.',
        });

        expect(result).toEqual({
            orderId: null,
            status: 'INFO',
            trackingNumber: null,
        });
    });
});
