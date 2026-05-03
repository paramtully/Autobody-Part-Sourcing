import type { VendorOrderClient } from './vendorOrderClient';

export class VendorOrderClientRegistry {
  private readonly clients = new Map<string, VendorOrderClient>();

  register(client: VendorOrderClient): void {
    this.clients.set(client.vendorId, client);
  }

  get(vendorId: string): VendorOrderClient {
    const client = this.clients.get(vendorId);
    if (!client) {
      throw new Error(`No VendorOrderClient registered for vendorId="${vendorId}"`);
    }
    return client;
  }

  has(vendorId: string): boolean {
    return this.clients.has(vendorId);
  }

  registeredVendorIds(): string[] {
    return Array.from(this.clients.keys());
  }
}
