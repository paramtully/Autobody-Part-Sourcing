import { describe, it, expect } from '@jest/globals';
import { computeOrderPricing, PLATFORM_MINIMUM_CHARGE_MINOR } from '../order';
import { Currency } from '../../listing/currency';

describe('computeOrderPricing', () => {
    it('should compute standard 3% fee correctly', () => {
        const result = computeOrderPricing({
            partPriceMinor: 10000, // $100.00
            feePercent: 0.03,
            shippingMinor: 500,
            taxMinor: 800,
            currency: Currency.USD,
        });

        expect(result.serviceFeeMinor).toBe(300); // round(10000 * 0.03)
        expect(result.totalMinor).toBe(11600); // 10000 + 300 + 500 + 800
        expect(result.feePercentApplied).toBe(0.03);
    });

    it('should round fractional pennies correctly', () => {
        const result = computeOrderPricing({
            partPriceMinor: 3333, // $33.33
            feePercent: 0.03,
            shippingMinor: 0,
            taxMinor: 0,
            currency: Currency.USD,
        });

        // round(3333 * 0.03) = round(99.99) = 100
        expect(result.serviceFeeMinor).toBe(100);
        expect(result.totalMinor).toBe(3433);
    });

    it('should handle zero service fee for very small prices', () => {
        const result = computeOrderPricing({
            partPriceMinor: 1, // $0.01
            feePercent: 0.03,
            shippingMinor: 200,
            taxMinor: 0,
            currency: Currency.USD,
        });

        // round(1 * 0.03) = round(0.03) = 0
        expect(result.serviceFeeMinor).toBe(0);
        expect(result.totalMinor).toBe(201); // 1 + 0 + 200 + 0
    });

    it('should enforce total integrity (total = partPrice + fee + shipping + tax)', () => {
        const result = computeOrderPricing({
            partPriceMinor: 5000,
            feePercent: 0.05,
            shippingMinor: 1000,
            taxMinor: 600,
            currency: Currency.USD,
        });

        const expectedTotal =
            result.partPriceMinor +
            result.serviceFeeMinor +
            result.shippingMinor +
            result.taxMinor;

        expect(result.totalMinor).toBe(expectedTotal);
    });

    it('should throw if total is below PLATFORM_MINIMUM_CHARGE_MINOR', () => {
        expect(() =>
            computeOrderPricing({
                partPriceMinor: 10,
                feePercent: 0.03,
                shippingMinor: 0,
                taxMinor: 0,
                currency: Currency.USD,
            }),
        ).toThrow(/below platform minimum/i);
    });

    it('should store the exact feePercentApplied used in computation', () => {
        const feePercent = 0.0275;
        const result = computeOrderPricing({
            partPriceMinor: 10000,
            feePercent,
            shippingMinor: 500,
            taxMinor: 0,
            currency: Currency.USD,
        });

        expect(result.feePercentApplied).toBe(feePercent);
        expect(result.serviceFeeMinor).toBe(Math.round(10000 * feePercent));
    });

    it('should handle different currencies', () => {
        const result = computeOrderPricing({
            partPriceMinor: 20000,
            feePercent: 0.03,
            shippingMinor: 1500,
            taxMinor: 2000,
            currency: Currency.EUR,
        });

        expect(result.currency).toBe(Currency.EUR);
        expect(result.totalMinor).toBe(20000 + 600 + 1500 + 2000);
    });

    it('should accept exactly PLATFORM_MINIMUM_CHARGE_MINOR as total', () => {
        // This should NOT throw
        const result = computeOrderPricing({
            partPriceMinor: PLATFORM_MINIMUM_CHARGE_MINOR,
            feePercent: 0,
            shippingMinor: 0,
            taxMinor: 0,
            currency: Currency.USD,
        });

        expect(result.totalMinor).toBe(PLATFORM_MINIMUM_CHARGE_MINOR);
    });
});
