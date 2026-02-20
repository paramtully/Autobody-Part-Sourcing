/**
 * CCC One-specific Zod schemas for ordering API response validation.
 *
 * CCC One is an estimating/broker platform. Orders are submitted via API
 * but confirmed asynchronously as the underlying supplier processes them.
 *
 * Covers three endpoints:
 * - POST /orders/quote   → shipping estimate response (not a firm quote)
 * - POST /orders/submit  → order submission response (returns PENDING)
 * - GET  /orders/{id}    → order status polling response
 *
 * Key differences from LKQ:
 * - Shipping costs are estimates, not firm quotes
 * - Orders always start as PENDING; confirmation is async
 * - No cancellation support through the platform
 *
 * Uses .passthrough() for forward-compatibility.
 */

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────
// Shipping estimate response
// ────────────────────────────────────────────────────────────────

export const cccShippingEstimateResponseSchema = z.object({
  /** Whether an estimate could be generated. */
  estimated: z.boolean(),

  /** Estimated shipping cost in minor units (cents). */
  estimatedShippingMinor: z.number().int().nonnegative().optional(),

  /** Confidence level of the estimate (0-1 scale). */
  confidence: z.number().min(0).max(1).optional(),

  /** Reason estimate could not be generated (when estimated=false). */
  reason: z.string().optional(),

  /** CCC-assigned request ID. */
  requestId: z.string().optional(),
}).passthrough();

// ────────────────────────────────────────────────────────────────
// Order submission response
// ────────────────────────────────────────────────────────────────

export const cccOrderSubmissionResponseSchema = z.object({
  /**
   * Submission outcome.
   * - 'accepted': Order accepted into the supplier network. Confirmation async.
   * - 'rejected': Order rejected immediately (invalid part, policy, etc.).
   * - 'error': Server-side error during submission.
   */
  status: z.enum(['accepted', 'rejected', 'error']),

  /** CCC-assigned order reference. Present when status='accepted'. */
  orderRef: z.string().optional(),

  /** Expected time in minutes for supplier to confirm. */
  expectedConfirmationMinutes: z.number().int().positive().optional(),

  /** Rejection reason. Present when status='rejected'. */
  rejectionReason: z.string().optional(),

  /** Error message. Present when status='error'. */
  errorMessage: z.string().optional(),

  /** Whether the error is transient. */
  retryable: z.boolean().optional(),

  /** CCC-assigned request ID. */
  requestId: z.string().optional(),
}).passthrough();

// ────────────────────────────────────────────────────────────────
// Order status polling response
// ────────────────────────────────────────────────────────────────

export const cccOrderStatusResponseSchema = z.object({
  /**
   * Current order status from the supplier network.
   * - 'pending': Awaiting supplier confirmation.
   * - 'confirmed': Supplier confirmed the order.
   * - 'shipped': Order has been shipped by the supplier.
   * - 'cancelled': Order was cancelled.
   * - 'failed': Order processing failed.
   */
  status: z.enum(['pending', 'confirmed', 'shipped', 'cancelled', 'failed']),

  /** Estimated ship date (ISO 8601). Present when confirmed or shipped. */
  estimatedShipDate: z.string().optional(),

  /** Tracking number. Present when status='shipped'. */
  trackingNumber: z.string().optional(),

  /** Carrier name. Present when status='shipped'. */
  carrier: z.string().optional(),

  /** Cancellation or failure reason. */
  reason: z.string().optional(),

  /** Name of the supplier fulfilling the order. */
  supplierName: z.string().optional(),

  /** CCC-assigned request ID. */
  requestId: z.string().optional(),
}).passthrough();

// ────────────────────────────────────────────────────────────────
// Type inference
// ────────────────────────────────────────────────────────────────

export type CccShippingEstimateResponse = z.infer<typeof cccShippingEstimateResponseSchema>;
export type CccOrderSubmissionResponse = z.infer<typeof cccOrderSubmissionResponseSchema>;
export type CccOrderStatusResponse = z.infer<typeof cccOrderStatusResponseSchema>;
