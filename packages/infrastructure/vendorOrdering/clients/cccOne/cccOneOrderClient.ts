/**
 * CCC One order client.
 *
 * Implements VendorOrderClient for CCC One's asynchronous ordering API (API_ASYNC mode).
 *
 * Integration profile:
 * - Auth: OAuth 2.0 client_credentials via CccOneAuthProvider (same as inventory client)
 * - Ordering: Asynchronous — POST /orders/submit returns PENDING; confirmation via polling
 * - Idempotency: orderId sent as X-Idempotency-Key header
 * - Rate limit: Strict daily limits (50-1000/day), 429 with Retry-After header
 * - Cancellation: NOT supported through CCC platform
 * - Status lookup: Supported via GET /orders/{id} (poll for async confirmation)
 *
 * Design differences from LKQ (API_SYNC):
 * - Orders always return PENDING, never immediate CONFIRMED
 * - Shipping costs are estimates, not firm quotes (returns ESTIMATE, not QUOTED)
 * - Auth token lifecycle managed by separate CccOneAuthProvider
 * - On 401/403, invalidates token before throwing (likely expired)
 *
 * Responsibilities:
 * - Submit orders to CCC supplier network
 * - Fetch shipping estimates
 * - Poll for asynchronous order status
 * - Handle vendor-specific error responses
 *
 * Does NOT: write to DB, manage retries, contain business logic.
 */

import type { VendorOrderClient, ShippingQuoteRequest, ShippingQuoteResult, VendorOrderRequest, VendorOrderResult, VendorOrderStatus } from '../../vendorOrderClient';
import type { VendorClientError } from '../../../vendors/inventoryClient';
import type { HttpTransport } from '../../../vendors/clients/shared/httpTransport';
import type { VendorClientConfig } from '../../../vendors/clients/shared/vendorClientConfig';
import type { CccOneAuthProvider } from '../../../vendors/clients/cccOne/cccOneAuthProvider';
import {
  cccShippingEstimateResponseSchema,
  cccOrderSubmissionResponseSchema,
  cccOrderStatusResponseSchema,
} from './cccOneOrderResponseSchema';

/**
 * CCC One order client.
 *
 * Submits orders asynchronously via CCC One's supplier network.
 * Designed to work without internal retry logic --
 * retry is composed externally by VendorOrderService.
 */
export class CccOneOrderClient implements VendorOrderClient {
  constructor(
    private readonly config: VendorClientConfig,
    private readonly transport: HttpTransport,
    private readonly authProvider: CccOneAuthProvider,
  ) {}

  /**
   * Get a shipping estimate from CCC One.
   *
   * POST /orders/quote
   *
   * CCC One provides shipping estimates, not firm quotes.
   * Prices are derived from the supplier network and may have
   * low confidence for uncommon parts.
   */
  async getShippingQuote(input: ShippingQuoteRequest): Promise<ShippingQuoteResult> {
    const token = await this.authProvider.getAccessToken();

    const body = {
      partNumber: input.partNumber,
      listingId: input.listingId,
      destinationAddress: {
        line1: input.shippingAddress.line1,
        line2: input.shippingAddress.line2,
        city: input.shippingAddress.city,
        state: input.shippingAddress.state,
        postalCode: input.shippingAddress.postalCode,
        country: input.shippingAddress.country,
      },
      currency: input.currency,
    };

    const response = await this.transport.post(
      `${this.config.baseUrl}/orders/quote`,
      body,
      {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    );

    if (response.status !== 200) {
      this.throwVendorError(response.status, response.headers, response.rawBody);
    }

    const parsed = cccShippingEstimateResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      this.throwValidationError(`CCC One shipping estimate validation failed: ${parsed.error.message}`, response.body);
    }

    const data = parsed.data;

    if (!data.estimated || data.estimatedShippingMinor === undefined) {
      return { status: 'NOT_SUPPORTED' };
    }

    // CCC returns estimates, not firm quotes
    return {
      status: 'ESTIMATE',
      shippingMinor: data.estimatedShippingMinor,
    };
  }

  /**
   * Submit an order to CCC One's supplier network.
   *
   * POST /orders/submit
   *
   * CCC One always returns PENDING because orders are routed to
   * the supplier network for asynchronous confirmation. The caller
   * should poll getOrderStatus to track the order.
   */
  async placeOrder(input: VendorOrderRequest): Promise<VendorOrderResult> {
    const token = await this.authProvider.getAccessToken();

    const body = {
      partNumber: input.partNumber,
      listingId: input.listingId,
      quantity: input.quantity,
      shippingAddress: {
        line1: input.shippingAddress.line1,
        line2: input.shippingAddress.line2,
        city: input.shippingAddress.city,
        state: input.shippingAddress.state,
        postalCode: input.shippingAddress.postalCode,
        country: input.shippingAddress.country,
      },
      contactEmail: input.contactEmail,
    };

    const response = await this.transport.post(
      `${this.config.baseUrl}/orders/submit`,
      body,
      {
        'Authorization': `Bearer ${token}`,
        'X-Idempotency-Key': input.orderId,
        'Accept': 'application/json',
      },
    );

    if (response.status !== 200 && response.status !== 202) {
      this.throwVendorError(response.status, response.headers, response.rawBody);
    }

    const parsed = cccOrderSubmissionResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      this.throwValidationError(`CCC One order submission validation failed: ${parsed.error.message}`, response.body);
    }

    const data = parsed.data;

    switch (data.status) {
      case 'accepted':
        return {
          status: 'PENDING',
          vendorOrderId: data.orderRef ?? 'unknown',
          expectedConfirmationMinutes: data.expectedConfirmationMinutes,
        };

      case 'rejected':
        return {
          status: 'REJECTED',
          reason: data.rejectionReason ?? 'Order rejected by CCC One supplier network',
        };

      case 'error':
        return {
          status: 'ERROR',
          error: data.errorMessage ?? 'Unknown CCC One order error',
          retryable: data.retryable ?? false,
        };
    }
  }

  // cancelOrder is intentionally NOT implemented.
  // CCC One does not support cancellation through its platform.

  /**
   * Poll for order status from CCC One.
   *
   * GET /orders/{vendorOrderId}
   *
   * Used to check whether an asynchronously submitted order
   * has been confirmed, shipped, or rejected by the supplier.
   */
  async getOrderStatus(vendorOrderId: string): Promise<VendorOrderStatus> {
    const token = await this.authProvider.getAccessToken();

    const response = await this.transport.get(
      `${this.config.baseUrl}/orders/${encodeURIComponent(vendorOrderId)}`,
      {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    );

    if (response.status !== 200) {
      this.throwVendorError(response.status, response.headers, response.rawBody);
    }

    const parsed = cccOrderStatusResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      this.throwValidationError(`CCC One order status validation failed: ${parsed.error.message}`, response.body);
    }

    const data = parsed.data;

    switch (data.status) {
      case 'pending':
        return { status: 'PENDING' };

      case 'confirmed':
        return {
          status: 'CONFIRMED',
          estimatedShipDate: data.estimatedShipDate ? new Date(data.estimatedShipDate) : undefined,
        };

      case 'shipped':
        return {
          status: 'SHIPPED',
          trackingNumber: data.trackingNumber,
        };

      case 'cancelled':
        return {
          status: 'CANCELLED',
          reason: data.reason,
        };

      case 'failed':
        return {
          status: 'CANCELLED',
          reason: data.reason ?? 'Order processing failed in supplier network',
        };

      default:
        return { status: 'UNKNOWN' };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────

  /**
   * Extract CCC request ID from response body for error correlation.
   */
  private extractRequestId(body: unknown): string | undefined {
    if (body && typeof body === 'object' && 'requestId' in body) {
      const val = (body as Record<string, unknown>).requestId;
      return typeof val === 'string' ? val : undefined;
    }
    return undefined;
  }

  /**
   * Throw a structured VendorClientError for non-2xx responses.
   *
   * On 401/403, invalidates the OAuth token before throwing
   * because the most likely cause is token expiry.
   *
   * Error classification:
   * - 429 -> RATE_LIMIT (retryable)
   * - 401/403 -> AUTH_ERROR (non-retryable, token invalidated)
   * - 400 -> INVALID_REQUEST (non-retryable)
   * - 5xx -> SERVER_ERROR (retryable)
   */
  private throwVendorError(status: number, headers: Record<string, string>, rawBody: string): never {
    let errorType: VendorClientError['type'];
    if (status === 429) {
      errorType = 'RATE_LIMIT';
    } else if (status === 401 || status === 403) {
      // Invalidate token on auth errors -- likely expired
      this.authProvider.invalidateToken();
      errorType = 'AUTH_ERROR';
    } else if (status === 400) {
      errorType = 'INVALID_REQUEST';
    } else if (status >= 500) {
      errorType = 'SERVER_ERROR';
    } else {
      errorType = 'SERVER_ERROR';
    }

    const error: VendorClientError = {
      type: errorType,
      message: `CCC One ordering API returned HTTP ${status}: ${rawBody.substring(0, 200)}`,
      vendorId: this.config.vendorId,
      correlationId: headers['x-request-id'] ?? 'unknown',
    };

    const throwable = new Error(error.message);
    Object.assign(throwable, { status, ...error });
    throw throwable;
  }

  /**
   * Throw a structured validation error for malformed responses.
   */
  private throwValidationError(message: string, body: unknown): never {
    const error: VendorClientError = {
      type: 'VALIDATION_ERROR',
      message,
      vendorId: this.config.vendorId,
      correlationId: this.extractRequestId(body) ?? 'unknown',
    };
    const throwable = new Error(error.message);
    Object.assign(throwable, error);
    throw throwable;
  }
}
