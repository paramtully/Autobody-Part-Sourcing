import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import type { CheckoutService } from '@repo/ordering';
import { CheckoutError, QuoteExpiredError, NotFoundError } from '@repo/ordering';

// ── Schemas ───────────────────────────────────────────────────────────────────
// .strict() rejects any unknown keys — prevents clients from injecting pricing
// fields (itemPriceMinor, serviceFeeMinor, etc.).

const shippingAddressSchema = z
  .object({
    line1: z.string().min(1),
    city: z.string().min(1),
    stateOrProvince: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().length(2),
  })
  .strict();

const quoteBodySchema = z
  .object({
    listingId: z.string().uuid(),
    shippingAddress: shippingAddressSchema,
  })
  .strict();

const confirmBodySchema = z
  .object({
    quoteId: z.string().uuid(),
    contactEmail: z.string().email(),
    contactPhone: z.string().optional(),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

// ── Router factory ────────────────────────────────────────────────────────────

export function checkoutRouter(checkout: CheckoutService): Router {
  const router = express.Router();

  /**
   * POST /checkout/quote
   * Returns: { quoteId, itemPriceMinor, shippingMinor, serviceFeeMinor, currency, expiresAt }
   * No pricing fields accepted in the request body.
   * Taxes are deferred to Stripe at /checkout/confirm.
   */
  router.post('/quote', async (req: Request, res: Response) => {
    const parsed = quoteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    try {
      const quote = await checkout.createQuote(parsed.data);
      res.status(200).json(quote);
    } catch (err) {
      handleCheckoutError(err, res);
    }
  });

  /**
   * POST /checkout/confirm
   * Accepts only: quoteId, contactEmail, contactPhone?, idempotencyKey.
   * All pricing is read from the DB checkout_quotes row — no client-supplied amounts.
   * Returns: { orderId, orderLookupToken, providerClientToken }
   */
  router.post('/confirm', async (req: Request, res: Response) => {
    const parsed = confirmBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    try {
      const result = await checkout.confirm(parsed.data);
      res.status(200).json(result);
    } catch (err) {
      handleCheckoutError(err, res);
    }
  });

  return router;
}

function handleCheckoutError(err: unknown, res: Response): void {
  if (err instanceof QuoteExpiredError) {
    res.status(410).json({ error: err.message });
    return;
  }
  if (err instanceof CheckoutError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  console.error('[checkout route] unexpected error', err);
  res.status(500).json({ error: 'Internal server error' });
}
