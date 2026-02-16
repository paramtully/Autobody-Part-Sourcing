/**
 * Configuration types for vendor inventory clients.
 *
 * All credentials come from environment variables, never hardcoded.
 * Each vendor client receives its config via constructor injection.
 */

/**
 * API Key + HMAC signature authentication.
 * Used by vendors like LKQ that require signed requests.
 */
export interface ApiKeyHmacCredentials {
  readonly type: 'API_KEY_HMAC';
  readonly apiKey: string;
  readonly apiSecret: string;
}

/**
 * OAuth 2.0 client_credentials authentication.
 * Used by vendors like CCC One that issue short-lived tokens.
 * Optional mTLS certificate path for production environments.
 */
export interface OAuth2Credentials {
  readonly type: 'OAUTH2';
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenUrl: string;
  readonly certPath?: string;
}

/**
 * No authentication required.
 * Used by scraper clients accessing public websites.
 */
export interface NoCredentials {
  readonly type: 'NONE';
}

/**
 * Union of all supported credential types.
 */
export type VendorCredentials =
  | ApiKeyHmacCredentials
  | OAuth2Credentials
  | NoCredentials;

/**
 * Configuration for a vendor inventory client.
 *
 * Injected into client constructors. The `useMockTransport` flag
 * controls whether the client uses real HTTP or fixture data,
 * enabling development without API keys.
 */
export interface VendorClientConfig {
  /** Internal vendor identifier (matches domain Vendor.id). */
  readonly vendorId: string;

  /** Base URL for the vendor API or website. */
  readonly baseUrl: string;

  /** Authentication credentials for this vendor. */
  readonly credentials: VendorCredentials;

  /** Per-request timeout in milliseconds. Default: 30_000. */
  readonly timeoutMs: number;

  /** Vendor-imposed rate limit (requests per minute). Used by RateLimiter. */
  readonly rateLimitPerMinute: number;

  /** When true, the client uses FixtureHttpTransport instead of real HTTP. */
  readonly useMockTransport: boolean;
}

/**
 * Creates a VendorClientConfig with sensible defaults.
 * Override any field via the `overrides` parameter.
 */
export function createVendorClientConfig(
  overrides: Partial<VendorClientConfig> & Pick<VendorClientConfig, 'vendorId' | 'baseUrl' | 'credentials'>
): VendorClientConfig {
  return {
    timeoutMs: 30_000,
    rateLimitPerMinute: 60,
    useMockTransport: false,
    ...overrides,
  };
}
