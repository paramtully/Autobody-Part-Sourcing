import type { VendorOrderClient } from './vendorOrderClient';
import type { VendorOrderingMode } from '@domain/order/vendorOrderingMode';

/**
 * Error thrown when no client is registered for a vendor's ordering mode.
 */
export class NoClientRegisteredError extends Error {
    constructor(public readonly mode: VendorOrderingMode) {
        super(`No VendorOrderClient registered for ordering mode: ${mode}`);
        this.name = 'NoClientRegisteredError';
    }
}

/**
 * Registry that maps VendorOrderingMode → VendorOrderClient implementation.
 * Adding a new ordering mode only requires registering a new implementation here.
 */
export class VendorOrderClientRegistry {
    private readonly clients = new Map<VendorOrderingMode, VendorOrderClient>();

    register(mode: VendorOrderingMode, client: VendorOrderClient): void {
        this.clients.set(mode, client);
    }

    /**
     * Returns the client for the given mode.
     * @throws NoClientRegisteredError if no client is registered for the mode
     */
    getClient(mode: VendorOrderingMode): VendorOrderClient {
        const client = this.clients.get(mode);
        if (!client) {
            throw new NoClientRegisteredError(mode);
        }
        return client;
    }

    hasClient(mode: VendorOrderingMode): boolean {
        return this.clients.has(mode);
    }
}
