/**
 * Client registry: configures and registers all vendor inventory clients
 * with the VendorInventoryClientFactory.
 *
 * Reads configuration from environment variables. Each vendor's client
 * is lazy-constructed via factory functions (not instantiated until needed).
 *
 * Environment variables per vendor:
 * - LKQ:          LKQ_API_KEY, LKQ_API_SECRET, LKQ_BASE_URL
 * - CCC One:      CCC_CLIENT_ID, CCC_CLIENT_SECRET, CCC_TOKEN_URL, CCC_BASE_URL
 * - Car-Part.com: CARPART_API_KEY, CARPART_BASE_URL
 *
 * Set USE_MOCK_TRANSPORT=true to use fixture data instead of real HTTP.
 */

import { VendorInventoryClientFactory } from './shared/vendorClientFactory';
import { FetchHttpTransport, FixtureHttpTransport } from './shared/httpTransport';
import { createVendorClientConfig } from './shared/vendorClientConfig';
import type { VendorClientConfig } from './shared/vendorClientConfig';
import type { HttpTransport } from './shared/httpTransport';
import { LKQInventoryClient } from './lkq/lkqInventoryClient';
import { CccOneInventoryClient } from './cccOne/cccOneInventoryClient';
import { CccOneOAuthProvider, MockCccOneAuthProvider } from './cccOne/cccOneAuthProvider';
import { CarPartComInventoryClient } from './carPartCom/carPartComInventoryClient';

/**
 * Environment variables used by the client registry.
 * All are optional -- missing vars means the vendor won't be registered.
 */
export interface ClientRegistryEnv {
  // Global
  USE_MOCK_TRANSPORT?: string;

  // LKQ
  LKQ_API_KEY?: string;
  LKQ_API_SECRET?: string;
  LKQ_BASE_URL?: string;

  // CCC One
  CCC_CLIENT_ID?: string;
  CCC_CLIENT_SECRET?: string;
  CCC_TOKEN_URL?: string;
  CCC_BASE_URL?: string;

  // Car-Part.com
  CARPART_API_KEY?: string;
  CARPART_BASE_URL?: string;
}

/**
 * Create and configure the VendorInventoryClientFactory with all
 * available vendor clients based on environment variables.
 *
 * Vendors with missing credentials are skipped (not registered).
 * Returns the factory with all configured vendors ready to create.
 *
 * @param env - Environment variables (defaults to process.env)
 * @returns Configured factory with all available vendor clients
 */
export function createClientRegistry(
  env: ClientRegistryEnv = process.env as ClientRegistryEnv
): VendorInventoryClientFactory {
  const factory = new VendorInventoryClientFactory();
  const useMock = env.USE_MOCK_TRANSPORT === 'true';

  // Register LKQ
  if (env.LKQ_API_KEY && env.LKQ_API_SECRET) {
    const config = createLkqConfig(env, useMock);
    factory.register('lkq', () => {
      const transport = createTransport(config);
      return new LKQInventoryClient(config, transport);
    });
  }

  // Register CCC One
  if (env.CCC_CLIENT_ID && env.CCC_CLIENT_SECRET) {
    const config = createCccConfig(env, useMock);
    factory.register('ccc-one', () => {
      const transport = createTransport(config);
      const authProvider = useMock
        ? new MockCccOneAuthProvider()
        : new CccOneOAuthProvider(
            env.CCC_CLIENT_ID!,
            env.CCC_CLIENT_SECRET!,
            config.baseUrl + '/oauth/token',
            transport
          );
      return new CccOneInventoryClient(config, transport, authProvider);
    });
  }

  // Register Car-Part.com
  if (env.CARPART_API_KEY || useMock) {
    const config = createCarPartConfig(env, useMock);
    factory.register('car-part-com', () => {
      const transport = createTransport(config);
      return new CarPartComInventoryClient(config, transport);
    });
  }

  return factory;
}

/**
 * Create LKQ client config from environment variables.
 */
function createLkqConfig(env: ClientRegistryEnv, useMock: boolean): VendorClientConfig {
  return createVendorClientConfig({
    vendorId: 'lkq',
    baseUrl: env.LKQ_BASE_URL ?? 'https://api.lkqcorp.com/v1/inventory',
    credentials: {
      type: 'API_KEY_HMAC',
      apiKey: env.LKQ_API_KEY!,
      apiSecret: env.LKQ_API_SECRET!,
    },
    timeoutMs: 30_000,
    rateLimitPerMinute: 200,
    useMockTransport: useMock,
  });
}

/**
 * Create CCC One client config from environment variables.
 */
function createCccConfig(env: ClientRegistryEnv, useMock: boolean): VendorClientConfig {
  return createVendorClientConfig({
    vendorId: 'ccc-one',
    baseUrl: env.CCC_BASE_URL ?? 'https://api.cccis.com/v1',
    credentials: {
      type: 'OAUTH2',
      clientId: env.CCC_CLIENT_ID!,
      clientSecret: env.CCC_CLIENT_SECRET!,
      tokenUrl: (env.CCC_TOKEN_URL ?? env.CCC_BASE_URL ?? 'https://api.cccis.com/v1') + '/oauth/token',
    },
    timeoutMs: 30_000,
    rateLimitPerMinute: 10, // CCC has strict daily limits
    useMockTransport: useMock,
  });
}

/**
 * Create Car-Part.com client config from environment variables.
 */
function createCarPartConfig(env: ClientRegistryEnv, useMock: boolean): VendorClientConfig {
  return createVendorClientConfig({
    vendorId: 'car-part-com',
    baseUrl: env.CARPART_BASE_URL ?? 'https://www.car-part.com',
    credentials: env.CARPART_API_KEY
      ? {
          type: 'API_KEY_HMAC',
          apiKey: env.CARPART_API_KEY,
          apiSecret: '', // Car-Part.com uses simple API key, no HMAC
        }
      : { type: 'NONE' },
    timeoutMs: 30_000,
    rateLimitPerMinute: 100,
    useMockTransport: useMock,
  });
}

/**
 * Create an HTTP transport based on the config's useMockTransport flag.
 */
function createTransport(config: VendorClientConfig): HttpTransport {
  if (config.useMockTransport) {
    return new FixtureHttpTransport();
  }
  return new FetchHttpTransport(config.timeoutMs);
}
