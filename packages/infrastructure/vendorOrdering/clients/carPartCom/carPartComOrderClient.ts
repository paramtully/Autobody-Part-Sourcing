/**
 * Car-Part.com order client.
 *
 * Implements VendorOrderClient for Car-Part.com's email-based ordering (EMAIL_MANUAL mode).
 *
 * Integration profile:
 * - Auth: None (email-based, no API auth required for ordering)
 * - Ordering: Manual — order details are emailed to the salvage yard; yard confirms offline
 * - Idempotency: orderId embedded in the email subject for deduplication
 * - Cancellation: NOT supported (manual process between buyer and yard)
 * - Status lookup: NOT supported (manual process)
 * - Shipping quotes: NOT supported (salvage yards don't provide programmatic quotes)
 *
 * Car-Part.com is a marketplace aggregating thousands of independent salvage yards.
 * Most yards lack API ordering infrastructure. The standard workflow is:
 * 1. Platform sends a structured email to the yard's contact address
 * 2. Yard manually reviews and confirms via reply email
 * 3. Confirmation is processed upstream (outside this client's scope)
 *
 * Responsibilities:
 * - Format order details into a structured email body
 * - Send the email via the injected EmailService
 * - Return PENDING with a generated vendor order reference
 *
 * Does NOT: write to DB, manage retries, contain business logic.
 */

import { randomUUID } from 'crypto';
import type { VendorOrderClient, ShippingQuoteRequest, ShippingQuoteResult, VendorOrderRequest, VendorOrderResult } from '../../vendorOrderClient';
import type { EmailService } from '../../../ordering/vendorOrderService';

/** Prefix for generated vendor order references. */
const ORDER_REF_PREFIX = 'CPCOM';

/**
 * Car-Part.com order client.
 *
 * Sends order emails to salvage yards. No API interaction required.
 * Designed to work without internal retry logic --
 * retry is composed externally by VendorOrderService.
 */
export class CarPartComOrderClient implements VendorOrderClient {
  constructor(
    private readonly emailService: EmailService,
    private readonly platformReplyToAddress: string,
  ) {}

  /**
   * Shipping quotes are not supported for Car-Part.com.
   *
   * Salvage yards do not provide programmatic shipping quotes.
   * Shipping costs are determined after the yard confirms the order.
   */
  async getShippingQuote(_input: ShippingQuoteRequest): Promise<ShippingQuoteResult> {
    return { status: 'NOT_SUPPORTED' };
  }

  /**
   * Place an order with a salvage yard via email.
   *
   * Formats the order into a structured email and sends it to the
   * vendor's contact email address. The orderId is embedded in the
   * subject line for deduplication and tracking.
   *
   * Always returns PENDING because confirmation happens offline.
   *
   * @throws Error if the vendor email address is not available (vendorId is used as fallback)
   * @throws Error if the email service fails to send
   */
  async placeOrder(input: VendorOrderRequest): Promise<VendorOrderResult> {
    const vendorEmail = this.resolveVendorEmail(input.vendorId);
    if (!vendorEmail) {
      return {
        status: 'ERROR',
        error: `No contact email configured for vendor ${input.vendorId}. Cannot send order email.`,
        retryable: false,
      };
    }

    const vendorOrderRef = `${ORDER_REF_PREFIX}-${randomUUID()}`;
    const emailBody = this.formatOrderEmail(input, vendorOrderRef);

    try {
      await this.emailService.sendOrderToVendor({
        orderId: input.orderId,
        vendorEmail,
        replyToAddress: this.platformReplyToAddress,
        body: emailBody,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'ERROR',
        error: `Failed to send order email to ${vendorEmail}: ${message}`,
        retryable: true, // Email delivery failures are typically transient
      };
    }

    return {
      status: 'PENDING',
      vendorOrderId: vendorOrderRef,
    };
  }

  // cancelOrder is intentionally NOT implemented.
  // Cancellations with salvage yards are a manual process.

  // getOrderStatus is intentionally NOT implemented.
  // Order status tracking with salvage yards is a manual process.

  // ────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────

  /**
   * Registry of vendor contact emails.
   *
   * In production, this would be loaded from the Vendor domain model
   * (vendor.orderContactEmail). For now we maintain a static map
   * that is populated during registry wiring.
   */
  private vendorEmails = new Map<string, string>();

  /**
   * Register a vendor's contact email for ordering.
   * Called during registry wiring when vendor records are loaded.
   */
  registerVendorEmail(vendorId: string, email: string): void {
    this.vendorEmails.set(vendorId, email);
  }

  /**
   * Resolve the contact email for a vendor.
   */
  private resolveVendorEmail(vendorId: string): string | undefined {
    return this.vendorEmails.get(vendorId);
  }

  /**
   * Format order details into a structured, human-readable email body.
   *
   * The email is designed to be easily parsed by both humans and
   * potential future automation on the yard side.
   */
  private formatOrderEmail(input: VendorOrderRequest, vendorOrderRef: string): string {
    const addr = input.shippingAddress;

    return [
      `=== NEW PARTS ORDER ===`,
      ``,
      `Order Reference: ${vendorOrderRef}`,
      `Platform Order ID: ${input.orderId}`,
      ``,
      `--- Part Details ---`,
      `Part Number: ${input.partNumber}`,
      `Listing ID: ${input.listingId}`,
      `Quantity: ${input.quantity}`,
      ``,
      `--- Shipping Address ---`,
      `${addr.line1}`,
      addr.line2 ? `${addr.line2}` : null,
      `${addr.city}, ${addr.state} ${addr.postalCode}`,
      `${addr.country}`,
      ``,
      `--- Contact ---`,
      `Email: ${input.contactEmail}`,
      ``,
      `--- Instructions ---`,
      `Please confirm this order by replying to this email.`,
      `Include the Order Reference (${vendorOrderRef}) in your reply.`,
      ``,
      `If this part is no longer available, please reply with "UNAVAILABLE"`,
      `and a brief explanation.`,
      ``,
      `Thank you.`,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }
}
