/**
 * Vendor inventory client implementations.
 *
 * Re-exports all vendor client implementations, shared infrastructure,
 * and the client registry for factory-based client creation.
 */

// Shared infrastructure
export * from './shared';

// Vendor-specific clients
export * from './lkq';
export * from './cccOne';
export * from './carPartCom';

// Client registry (factory configuration)
export { createClientRegistry } from './clientRegistry';
export type { ClientRegistryEnv } from './clientRegistry';
