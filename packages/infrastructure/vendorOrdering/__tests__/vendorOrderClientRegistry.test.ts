import { describe, it, expect, jest } from '@jest/globals';
import { VendorOrderClientRegistry, NoClientRegisteredError } from '../vendorOrderClientRegistry';
import { VendorOrderingMode } from '@domain/order/vendorOrderingMode';
import type { VendorOrderClient } from '../vendorOrderClient';

const createMockClient = (): jest.Mocked<VendorOrderClient> => ({
    getShippingQuote: jest.fn<VendorOrderClient['getShippingQuote']>(),
    placeOrder: jest.fn<VendorOrderClient['placeOrder']>(),
});

describe('VendorOrderClientRegistry', () => {
    it('should register and retrieve a client', () => {
        const registry = new VendorOrderClientRegistry();
        const client = createMockClient();

        registry.register(VendorOrderingMode.API_SYNC, client);

        expect(registry.getClient(VendorOrderingMode.API_SYNC)).toBe(client);
    });

    it('should throw NoClientRegisteredError for unregistered mode', () => {
        const registry = new VendorOrderClientRegistry();

        expect(() => registry.getClient(VendorOrderingMode.EDI)).toThrow(NoClientRegisteredError);
    });

    it('should report hasClient correctly', () => {
        const registry = new VendorOrderClientRegistry();
        const client = createMockClient();

        expect(registry.hasClient(VendorOrderingMode.API_SYNC)).toBe(false);

        registry.register(VendorOrderingMode.API_SYNC, client);

        expect(registry.hasClient(VendorOrderingMode.API_SYNC)).toBe(true);
        expect(registry.hasClient(VendorOrderingMode.EMAIL_MANUAL)).toBe(false);
    });

    it('should allow overwriting a registration', () => {
        const registry = new VendorOrderClientRegistry();
        const client1 = createMockClient();
        const client2 = createMockClient();

        registry.register(VendorOrderingMode.API_SYNC, client1);
        registry.register(VendorOrderingMode.API_SYNC, client2);

        expect(registry.getClient(VendorOrderingMode.API_SYNC)).toBe(client2);
    });

    it('should support multiple distinct modes', () => {
        const registry = new VendorOrderClientRegistry();
        const syncClient = createMockClient();
        const asyncClient = createMockClient();
        const emailClient = createMockClient();

        registry.register(VendorOrderingMode.API_SYNC, syncClient);
        registry.register(VendorOrderingMode.API_ASYNC, asyncClient);
        registry.register(VendorOrderingMode.EMAIL_MANUAL, emailClient);

        expect(registry.getClient(VendorOrderingMode.API_SYNC)).toBe(syncClient);
        expect(registry.getClient(VendorOrderingMode.API_ASYNC)).toBe(asyncClient);
        expect(registry.getClient(VendorOrderingMode.EMAIL_MANUAL)).toBe(emailClient);
    });
});
