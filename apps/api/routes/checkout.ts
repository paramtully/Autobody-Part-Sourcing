import express, { type Request, type Response, type Router } from 'express';
import { CheckoutService } from '@repo/ordering';
import { CheckoutError, QuoteExpiredError, NotFoundError } from '@repo/ordering';
import { quoteBodySchema, confirmBodySchema } from '@repo/db';

const router = express.Router();
const checkout: CheckoutService = new CheckoutService();

/**
   * POST /checkout/quote
   * Accepts only: listingId, shippingAddress.
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

export default router;
