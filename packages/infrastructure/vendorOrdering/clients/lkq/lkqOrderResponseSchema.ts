/**
 * LKQ-specific Zod schemas for ordering API response validation.
 *
 * Covers three endpoints:
 * - POST /orders/shipping-quote  → shipping quote response
 * - POST /orders                 → order placement response
 * - GET  /orders/{id}/status     → order status response
 *
 * Uses .passthrough() for forward-compatibility -- LKQ may add fields
 * at any time and we want to capture them without breaking validation.
 */

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────
// Shipping quote response
// ────────────────────────────────────────────────────────────────

export const lkqShippingQuoteResponseSchema = z.object({
  /** Whether a quote was successfully generated. */
  quoted: z.boolean(),

  /** Shipping cost in minor units (cents). Present when quoted=true. */
  shippingCostMinor: z.number().int().nonnegative().optional(),

  /** Tax in minor units (cents). Present when quoted=true. */
  taxMinor: z.number().int().nonnegative().optional(),

  /** LKQ-assigned quote reference for use in subsequent order placement. */
  quoteRef: z.string().optional(),

  /** Minutes until this quote expires. */
  validForMinutes: z.number().int().positive().optional(),

  /** Reason the quote could not be generated (when quoted=false). */
  reason: z.string().optional(),

  /** LKQ request ID for support correlation. */
  requestId: z.string().optional(),
}).passthrough();

// ────────────────────────────────────────────────────────────────
// Order placement response
// ────────────────────────────────────────────────────────────────

export const lkqOrderPlacementResponseSchema = z.object({
  /**
   * Order outcome from LKQ.
   * - 'confirmed': Order accepted and confirmed synchronously.
   * - 'rejected': Order rejected (part unavailable, policy violation, etc.).
   * - 'error': Server-side error during processing.
   */
  status: z.enum(['confirmed', 'rejected', 'error']),

  /** LKQ-assigned order ID. Present when status='confirmed'. */
  orderId: z.string().optional(),

  /** Estimated ship date (ISO 8601). Present when status='confirmed'. */
  estimatedShipDate: z.string().optional(),

  /** Rejection reason. Present when status='rejected'. */
  rejectionReason: z.string().optional(),

  /** Error message. Present when status='error'. */
  errorMessage: z.string().optional(),

  /** Whether the error is transient and the request can be retried. */
  retryable: z.boolean().optional(),

  /** LKQ request ID for support correlation. */
  requestId: z.string().optional(),
}).passthrough();

// ────────────────────────────────────────────────────────────────
// Order status response
// ────────────────────────────────────────────────────────────────

export const lkqOrderStatusResponseSchema = z.object({
  /**
   * Current order status.
   * - 'confirmed': Order confirmed, awaiting shipment.
   * - 'processing': Order is being prepared.
   * - 'shipped': Order has been shipped.
   * - 'cancelled': Order was cancelled.
   */
  status: z.enum(['confirmed', 'processing', 'shipped', 'cancelled']),

  /** Estimated ship date (ISO 8601). */
  estimatedShipDate: z.string().optional(),

  /** Tracking number. Present when status='shipped'. */
  trackingNumber: z.string().optional(),

  /** Carrier name. Present when status='shipped'. */
  carrier: z.string().optional(),

  /** Cancellation reason. Present when status='cancelled'. */
  cancellationReason: z.string().optional(),

  /** LKQ request ID for support correlation. */
  requestId: z.string().optional(),
}).passthrough();

// ────────────────────────────────────────────────────────────────
// Type inference
// ────────────────────────────────────────────────────────────────

export type LkqShippingQuoteResponse = z.infer<typeof lkqShippingQuoteResponseSchema>;
export type LkqOrderPlacementResponse = z.infer<typeof lkqOrderPlacementResponseSchema>;
export type LkqOrderStatusResponse = z.infer<typeof lkqOrderStatusResponseSchema>;
