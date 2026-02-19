/**
 * Factory for creating VendorInventoryClient instances by vendor ID.
 *
 * Registry pattern: the orchestrator asks for a client by vendorId;
 * the factory returns the correct implementation with config already injected.
 *
 * Usage:
 *   const factory = new VendorInventoryClientFactory();
 *   factory.register('lkq', () => new LKQInventoryClient(config, transport));
 *   const client = factory.create('lkq');
 */

import type { VendorInventoryClient } from '../../inventoryClient';

/**
 * Factory function type that creates a VendorInventoryClient.
 */
export type VendorClientFactoryFn = () => VendorInventoryClient;

/**
 * Factory for creating vendor inventory clients.
 *
 * Separates client construction from client usage. The orchestrator
 * only depends on VendorInventoryClient interface + this factory,
 * never on concrete client implementations.
 */
export class VendorInventoryClientFactory {
  private readonly registry = new Map<string, VendorClientFactoryFn>();

  /**
   * Register a factory function for a vendor.
   *
   * @param vendorId - The vendor identifier (e.g., 'lkq', 'ccc-one', 'car-part-com')
   * @param factory - Factory function that creates the client instance
   * @throws Error if vendorId is already registered
   */
  register(vendorId: string, factory: VendorClientFactoryFn): void {
    if (this.registry.has(vendorId)) {
      throw new Error(
        `VendorInventoryClientFactory: vendor "${vendorId}" is already registered. ` +
        `Call unregister() first if you want to replace it.`
      );
    }
    this.registry.set(vendorId, factory);
  }

  /**
   * Unregister a vendor factory.
   *
   * @param vendorId - The vendor identifier to unregister
   * @returns true if the vendor was registered and has been removed
   */
  unregister(vendorId: string): boolean {
    return this.registry.delete(vendorId);
  }

  /**
   * Create a VendorInventoryClient for the given vendor.
   *
   * @param vendorId - The vendor identifier
   * @returns A new VendorInventoryClient instance
   * @throws Error if no factory is registered for the vendorId
   */
  create(vendorId: string): VendorInventoryClient {
    const factory = this.registry.get(vendorId);
    if (!factory) {
      const registered = this.listRegistered().join(', ') || '(none)';
      throw new Error(
        `VendorInventoryClientFactory: no client registered for vendor "${vendorId}". ` +
        `Registered vendors: [${registered}]`
      );
    }
    return factory();
  }

  /**
   * Check if a vendor is registered.
   *
   * @param vendorId - The vendor identifier to check
   * @returns true if a factory is registered for this vendor
   */
  has(vendorId: string): boolean {
    return this.registry.has(vendorId);
  }

  /**
   * List all registered vendor IDs.
   *
   * @returns Array of registered vendor identifiers
   */
  listRegistered(): string[] {
    return Array.from(this.registry.keys());
  }
}
