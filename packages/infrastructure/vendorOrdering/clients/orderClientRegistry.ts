/**
 * Order client registry: configures and registers all vendor order clients
 * with the VendorOrderClientRegistry.
 *
 * Reads configuration from environment variables. Each vendor's ordering
 * client is registered under its VendorOrderingMode.
 *
 * Vendor → Ordering Mode mapping:
 * - LKQ:          API_SYNC    (synchronous REST API ordering)
 * - CCC One:      API_ASYNC   (async order submission, poll for confirmation)
 * - Car-Part.com: EMAIL_MANUAL (email-based ordering to salvage yards)
 *
 * Environment variables (shared with inventory client registry):
 * - LKQ:          LKQ_API_KEY, LKQ_API_SECRET, LKQ_ORDER_BASE_URL
 * - CCC One:      CCC_CLIENT_ID, CCC_CLIENT_SECRET, CCC_TOKEN_URL, CCC_ORDER_BASE_URL
 * - Car-Part.com: CARPART_VENDOR_EMAIL, PLATFORM_REPLY_TO_EMAIL
 *
 * Set USE_MOCK_TRANSPORT=true to use fixture data instead of real HTTP.
 */

import { VendorOrderClientRegistry } from '../vendorOrderClientRegistry';
import { VendorOrderingMode } from '@domain/order/vendorOrderingMode';
import { FetchHttpTransport, FixtureHttpTransport } from '../../vendors/clients/shared/httpTransport';
import { createVendorClientConfig } from '../../vendors/clients/shared/vendorClientConfig';
import type { VendorClientConfig } from '../../vendors/clients/shared/vendorClientConfig';
import type { HttpTransport } from '../../vendors/clients/shared/httpTransport';
import { CccOneOAuthProvider, MockCccOneAuthProvider } from '../../vendors/clients/cccOne/cccOneAuthProvider';
import type { EmailService } from '../../ordering/vendorOrderService';
import { LkqOrderClient } from './lkq/lkqOrderClient';
import { CccOneOrderClient } from './cccOne/cccOneOrderClient';
import { CarPartComOrderClient } from './carPartCom/carPartComOrderClient';

/**
 * Environment variables used by the order client registry.
 * All are optional -- missing vars means the vendor's ordering mode won't be registered.
 */
export interface OrderClientRegistryEnv {
  // Global
  USE_MOCK_TRANSPORT?: string;

  // LKQ ordering
  LKQ_API_KEY?: string;
  LKQ_API_SECRET?: string;
  LKQ_ORDER_BASE_URL?: string;

  // CCC One ordering
  CCC_CLIENT_ID?: string;
  CCC_CLIENT_SECRET?: string;
  CCC_TOKEN_URL?: string;
  CCC_ORDER_BASE_URL?: string;

  // Car-Part.com ordering
  CARPART_VENDOR_EMAIL?: string;
  PLATFORM_REPLY_TO_EMAIL?: string;
}

/**
 * Dependencies that must be provided externally.
 * These are services that cannot be constructed from env vars alone.
 */
export interface OrderClientRegistryDeps {
  /** Email service for EMAIL_MANUAL vendors. Required if Car-Part.com ordering is enabled. */
  emailService?: EmailService;
}

/**
 * Create and configure the VendorOrderClientRegistry with all
 * available vendor order clients based on environment variables.
 *
 * Vendors with missing credentials are skipped (not registered).
 * Returns the registry with all configured ordering modes ready to use.
 *
 * @param env - Environment variables (defaults to process.env)
 * @param deps - External dependencies (email service, etc.)
 * @returns Configured VendorOrderClientRegistry
 */
export function createOrderClientRegistry(
  env: OrderClientRegistryEnv = process.env as OrderClientRegistryEnv,
  deps: OrderClientRegistryDeps = {},
): VendorOrderClientRegistry {
  const registry = new VendorOrderClientRegistry();
  const useMock = env.USE_MOCK_TRANSPORT === 'true';

  // ── LKQ: API_SYNC ──────────────────────────────────────────
  if (env.LKQ_API_KEY && env.LKQ_API_SECRET) {
    const config = createLkqOrderConfig(env, useMock);
    const transport = createTransport(config);
    const client = new LkqOrderClient(config, transport);
    registry.register(VendorOrderingMode.API_SYNC, client);
  }

  // ── CCC One: API_ASYNC ─────────────────────────────────────
  if (env.CCC_CLIENT_ID && env.CCC_CLIENT_SECRET) {
    const config = createCccOrderConfig(env, useMock);
    const transport = createTransport(config);
    const authProvider = useMock
      ? new MockCccOneAuthProvider()
      : new CccOneOAuthProvider(
          env.CCC_CLIENT_ID,
          env.CCC_CLIENT_SECRET,
          config.baseUrl + '/oauth/token',
          transport,
        );
    const client = new CccOneOrderClient(config, transport, authProvider);
    registry.register(VendorOrderingMode.API_ASYNC, client);
  }

  // ── Car-Part.com: EMAIL_MANUAL ─────────────────────────────
  if (deps.emailService) {
    const replyTo = env.PLATFORM_REPLY_TO_EMAIL ?? 'orders@platform.com';
    const client = new CarPartComOrderClient(deps.emailService, replyTo);

    // Register known vendor emails
    if (env.CARPART_VENDOR_EMAIL) {
      client.registerVendorEmail('car-part-com', env.CARPART_VENDOR_EMAIL);
    }

    registry.register(VendorOrderingMode.EMAIL_MANUAL, client);
  }

  return registry;
}

// ────────────────────────────────────────────────────────────────
// Config helpers
// ────────────────────────────────────────────────────────────────

/**
 * Create LKQ ordering client config from environment variables.
 * Uses a separate base URL from inventory (ordering endpoints may differ).
 */
function createLkqOrderConfig(env: OrderClientRegistryEnv, useMock: boolean): VendorClientConfig {
  return createVendorClientConfig({
    vendorId: 'lkq',
    baseUrl: env.LKQ_ORDER_BASE_URL ?? 'https://api.lkqcorp.com/v1',
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
 * Create CCC One ordering client config from environment variables.
 * Uses a separate base URL from inventory (ordering endpoints may differ).
 */
function createCccOrderConfig(env: OrderClientRegistryEnv, useMock: boolean): VendorClientConfig {
  return createVendorClientConfig({
    vendorId: 'ccc-one',
    baseUrl: env.CCC_ORDER_BASE_URL ?? 'https://api.cccis.com/v1',
    credentials: {
      type: 'OAUTH2',
      clientId: env.CCC_CLIENT_ID!,
      clientSecret: env.CCC_CLIENT_SECRET!,
      tokenUrl: (env.CCC_TOKEN_URL ?? env.CCC_ORDER_BASE_URL ?? 'https://api.cccis.com/v1') + '/oauth/token',
    },
    timeoutMs: 30_000,
    rateLimitPerMinute: 10,
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
