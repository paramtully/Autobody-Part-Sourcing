/**
 * OAuth 2.0 authentication provider for CCC One API.
 *
 * CCC One uses OAuth 2.0 client_credentials grant with optional mTLS.
 * Tokens expire every 3600 seconds (1 hour). This provider caches
 * the token and transparently refreshes it when expired.
 *
 * Designed as an injectable dependency -- the inventory client depends
 * on the CccOneAuthProvider interface, not this implementation.
 */

import type { HttpTransport } from '../shared/httpTransport';

/**
 * Auth provider interface for CCC One.
 *
 * Separated from the client so that:
 * - Token lifecycle is a single responsibility
 * - Can be mocked independently for testing
 * - Can be replaced with different auth mechanisms (e.g., service account)
 */
export interface CccOneAuthProvider {
  /**
   * Get a valid access token.
   * Returns a cached token if still valid, or refreshes automatically.
   */
  getAccessToken(): Promise<string>;

  /**
   * Get the expiration time of the current token.
   * Returns undefined if no token has been acquired yet.
   */
  getTokenExpiresAt(): Date | undefined;

  /**
   * Force-invalidate the cached token.
   * Next call to getAccessToken() will fetch a fresh token.
   */
  invalidateToken(): void;
}

/**
 * Token response from CCC One OAuth endpoint.
 */
interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/** Buffer time (in ms) before token expiry to trigger refresh. */
const TOKEN_REFRESH_BUFFER_MS = 60_000; // Refresh 1 minute before expiry

/**
 * OAuth 2.0 client_credentials implementation for CCC One.
 *
 * Usage:
 *   const auth = new CccOneOAuthProvider(clientId, clientSecret, tokenUrl, transport);
 *   const token = await auth.getAccessToken(); // cached + auto-refreshed
 */
export class CccOneOAuthProvider implements CccOneAuthProvider {
  private token: string | undefined;
  private expiresAt: Date | undefined;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tokenUrl: string,
    private readonly transport: HttpTransport
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.token && this.expiresAt && this.isTokenValid()) {
      return this.token;
    }
    return this.refreshToken();
  }

  getTokenExpiresAt(): Date | undefined {
    return this.expiresAt;
  }

  invalidateToken(): void {
    this.token = undefined;
    this.expiresAt = undefined;
  }

  /**
   * Fetch a new token from the CCC One OAuth endpoint.
   *
   * POST to tokenUrl with client_credentials grant type.
   * Caches the token and computes expiry time.
   */
  private async refreshToken(): Promise<string> {
    const response = await this.transport.post(
      this.tokenUrl,
      null, // Body is form-encoded, set via headers
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${this.encodeCredentials()}`,
      }
    );

    if (response.status !== 200) {
      const errorObj = new Error(
        `CCC One OAuth token request failed with HTTP ${response.status}: ${response.rawBody.substring(0, 200)}`
      );
      Object.assign(errorObj, { status: response.status, type: 'AUTH_ERROR' });
      throw errorObj;
    }

    const tokenData = response.body as TokenResponse;
    if (!tokenData?.access_token) {
      throw new Error('CCC One OAuth response missing access_token');
    }

    this.token = tokenData.access_token;
    this.expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    return this.token;
  }

  /**
   * Check if the current token is still valid (with buffer).
   */
  private isTokenValid(): boolean {
    if (!this.expiresAt) return false;
    return Date.now() < this.expiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS;
  }

  /**
   * Base64-encode client credentials for Basic auth header.
   */
  private encodeCredentials(): string {
    return Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
  }
}

/**
 * Mock auth provider for testing and development.
 * Always returns a static token without making HTTP calls.
 */
export class MockCccOneAuthProvider implements CccOneAuthProvider {
  private readonly staticToken: string;
  private readonly staticExpiresAt: Date;

  constructor(token: string = 'mock-ccc-token-12345', expiresInMs: number = 3600_000) {
    this.staticToken = token;
    this.staticExpiresAt = new Date(Date.now() + expiresInMs);
  }

  async getAccessToken(): Promise<string> {
    return this.staticToken;
  }

  getTokenExpiresAt(): Date {
    return this.staticExpiresAt;
  }

  invalidateToken(): void {
    // No-op for mock
  }
}
