/**
 * LKQ Corporation order client.
 *
 * Implements VendorOrderClient for LKQ's REST ordering API (API_SYNC mode).
 *
 * Integration profile:
 * - Auth: API Key + HMAC-SHA256 signature (same as inventory client)
 * - Ordering: Synchronous — POST /orders returns CONFIRMED or REJECTED immediately
 * - Idempotency: orderId sent as X-Idempotency-Key header
 * - Rate limit: ~200 req/min, Retry-After header on 429
 * - Cancellation: Supported via POST /orders/{id}/cancel
 * - Status lookup: Supported via GET /orders/{id}/status
 *
 * Responsibilities:
 * - Place orders and receive synchronous confirmation
 * - Fetch shipping quotes
 * - Cancel orders and check status
 * - Handle vendor-specific error responses
 * - Normalize transport-level data only (HTTP -> typed results)
 *
 * Does NOT: write to DB, manage retries, contain business logic.
 */

import { createHmac } from 'crypto';
import type { VendorOrderClient, ShippingQuoteRequest, ShippingQuoteResult, VendorOrderRequest, VendorOrderResult, VendorOrderStatus } from '../../vendorOrderClient';
import type { VendorClientError } from '../../../vendors/inventoryClient';
import type { HttpTransport } from '../../../vendors/clients/shared/httpTransport';
import type { VendorClientConfig, ApiKeyHmacCredentials } from '../../../vendors/clients/shared/vendorClientConfig';
import {
  lkqShippingQuoteResponseSchema,
  lkqOrderPlacementResponseSchema,
  lkqOrderStatusResponseSchema,
} from './lkqOrderResponseSchema';

/**
 * LKQ Corporation order client.
 *
 * Places orders synchronously via LKQ's REST API.
 * Designed to work without internal retry logic --
 * retry is composed externally by VendorOrderService.
 */
export class LkqOrderClient implements VendorOrderClient {
  private readonly credentials: ApiKeyHmacCredentials;

  constructor(
    private readonly config: VendorClientConfig,
    private readonly transport: HttpTransport,
  ) {
    if (config.credentials.type !== 'API_KEY_HMAC') {
      throw new Error(
        `LkqOrderClient requires API_KEY_HMAC credentials, got "${config.credentials.type}"`,
      );
    }
    this.credentials = config.credentials;
  }

  /**
   * Get a shipping quote from LKQ.
   *
   * POST /orders/shipping-quote
   *
   * LKQ provides firm quotes with a validity window.
   * The quoteRef can be passed when placing the order for price lock.
   */
  async getShippingQuote(input: ShippingQuoteRequest): Promise<ShippingQuoteResult> {
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

    const bodyStr = JSON.stringify(body);
    const timestamp = Date.now().toString();
    const signature = this.computeHmac(timestamp, bodyStr);

    const response = await this.transport.post(
      `${this.config.baseUrl}/orders/shipping-quote`,
      body,
      {
        'X-Api-Key': this.credentials.apiKey,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
        'Accept': 'application/json',
      },
    );

    if (response.status !== 200) {
      this.throwVendorError(response.status, response.headers, response.rawBody);
    }

    const parsed = lkqShippingQuoteResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      this.throwValidationError(`LKQ shipping quote response validation failed: ${parsed.error.message}`, response.body);
    }

    const data = parsed.data;

    if (!data.quoted) {
      return { status: 'NOT_SUPPORTED' };
    }

    return {
      status: 'QUOTED',
      shippingMinor: data.shippingCostMinor ?? 0,
      taxMinor: data.taxMinor ?? 0,
      vendorQuoteRef: data.quoteRef,
      validForMinutes: data.validForMinutes ?? 30,
    };
  }

  /**
   * Place an order with LKQ.
   *
   * POST /orders
   *
   * LKQ confirms orders synchronously. The orderId is used as the
   * idempotency key via the X-Idempotency-Key header, ensuring that
   * duplicate requests (e.g. after a network retry) do not create
   * duplicate orders.
   */
  async placeOrder(input: VendorOrderRequest): Promise<VendorOrderResult> {
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

    const bodyStr = JSON.stringify(body);
    const timestamp = Date.now().toString();
    const signature = this.computeHmac(timestamp, bodyStr);

    const response = await this.transport.post(
      `${this.config.baseUrl}/orders`,
      body,
      {
        'X-Api-Key': this.credentials.apiKey,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
        'X-Idempotency-Key': input.orderId,
        'Accept': 'application/json',
      },
    );

    if (response.status !== 200 && response.status !== 201) {
      this.throwVendorError(response.status, response.headers, response.rawBody);
    }

    const parsed = lkqOrderPlacementResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      this.throwValidationError(`LKQ order placement response validation failed: ${parsed.error.message}`, response.body);
    }

    const data = parsed.data;

    switch (data.status) {
      case 'confirmed':
        return {
          status: 'CONFIRMED',
          vendorOrderId: data.orderId ?? 'unknown',
          estimatedShipDate: data.estimatedShipDate ? new Date(data.estimatedShipDate) : undefined,
        };

      case 'rejected':
        return {
          status: 'REJECTED',
          reason: data.rejectionReason ?? 'Order rejected by LKQ',
        };

      case 'error':
        return {
          status: 'ERROR',
          error: data.errorMessage ?? 'Unknown LKQ order error',
          retryable: data.retryable ?? false,
        };
    }
  }

  /**
   * Cancel an order with LKQ.
   *
   * POST /orders/{vendorOrderId}/cancel
   *
   * @throws Error if the cancellation fails or the order is not cancellable
   */
  async cancelOrder(vendorOrderId: string): Promise<void> {
    const timestamp = Date.now().toString();
    const signature = this.computeHmac(timestamp, vendorOrderId);

    const response = await this.transport.post(
      `${this.config.baseUrl}/orders/${encodeURIComponent(vendorOrderId)}/cancel`,
      null,
      {
        'X-Api-Key': this.credentials.apiKey,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
        'Accept': 'application/json',
      },
    );

    if (response.status !== 200 && response.status !== 204) {
      this.throwVendorError(response.status, response.headers, response.rawBody);
    }
  }

  /**
   * Get the current status of an LKQ order.
   *
   * GET /orders/{vendorOrderId}/status
   */
  async getOrderStatus(vendorOrderId: string): Promise<VendorOrderStatus> {
    const timestamp = Date.now().toString();
    const queryString = `orderId=${encodeURIComponent(vendorOrderId)}`;
    const signature = this.computeHmac(timestamp, queryString);

    const response = await this.transport.get(
      `${this.config.baseUrl}/orders/${encodeURIComponent(vendorOrderId)}/status`,
      {
        'X-Api-Key': this.credentials.apiKey,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
        'Accept': 'application/json',
      },
    );

    if (response.status !== 200) {
      this.throwVendorError(response.status, response.headers, response.rawBody);
    }

    const parsed = lkqOrderStatusResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      this.throwValidationError(`LKQ order status response validation failed: ${parsed.error.message}`, response.body);
    }

    const data = parsed.data;

    switch (data.status) {
      case 'confirmed':
      case 'processing':
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
          reason: data.cancellationReason,
        };

      default:
        return { status: 'UNKNOWN' };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────

  /**
   * Compute HMAC-SHA256 signature for request authentication.
   * Signature = HMAC-SHA256(apiSecret, timestamp + body)
   */
  private computeHmac(timestamp: string, body: string): string {
    return createHmac('sha256', this.credentials.apiSecret)
      .update(timestamp + body)
      .digest('hex');
  }

  /**
   * Extract LKQ request ID from response body for error correlation.
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
   * Error classification:
   * - 429 -> RATE_LIMIT (retryable)
   * - 401/403 -> AUTH_ERROR (non-retryable)
   * - 400 -> INVALID_REQUEST (non-retryable)
   * - 409 -> INVALID_REQUEST (duplicate/conflict, non-retryable)
   * - 5xx -> SERVER_ERROR (retryable)
   */
  private throwVendorError(status: number, headers: Record<string, string>, rawBody: string): never {
    let errorType: VendorClientError['type'];
    if (status === 429) {
      errorType = 'RATE_LIMIT';
    } else if (status === 401 || status === 403) {
      errorType = 'AUTH_ERROR';
    } else if (status === 400 || status === 409) {
      errorType = 'INVALID_REQUEST';
    } else if (status >= 500) {
      errorType = 'SERVER_ERROR';
    } else {
      errorType = 'SERVER_ERROR';
    }

    const error: VendorClientError = {
      type: errorType,
      message: `LKQ ordering API returned HTTP ${status}: ${rawBody.substring(0, 200)}`,
      vendorId: this.config.vendorId,
      correlationId: headers['x-request-id'] ?? 'unknown',
      retryAfterMs: this.parseRetryAfterHeader(headers),
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

  /**
   * Parse Retry-After header from response headers.
   * Returns milliseconds to wait, or undefined if header not present.
   */
  private parseRetryAfterHeader(headers: Record<string, string>): number | undefined {
    const retryAfter = headers['retry-after'];
    if (!retryAfter) return undefined;

    const seconds = Number.parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    return undefined;
  }
}
