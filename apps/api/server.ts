import express = require('express');
import cors = require('cors');
import dotenv = require('dotenv');
import Stripe from 'stripe';
import { db } from '@repo/db';
import { VendorOrderClientRegistry, composeOrdering } from '@repo/ordering';
import { StripePaymentAdapter } from '@repo/ordering/stripe';
import { checkoutRouter } from './routes/checkout';
import { paymentWebhookRouter } from './routes/paymentWebhook';

dotenv.config();

// ── Payment provider ──────────────────────────────────────────────────────────
// Only this file and paymentProvider.stripe.ts import 'stripe'.

const stripeSecretKey = process.env['STRIPE_SECRET_KEY'];
const stripeWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];

if (!stripeSecretKey || !stripeWebhookSecret) {
  throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET env vars are required');
}

const stripeClient = new Stripe(stripeSecretKey);
const paymentProvider = new StripePaymentAdapter(stripeClient, stripeWebhookSecret);

// ── Vendor registry ───────────────────────────────────────────────────────────
// Register vendor order clients here. Empty for MVP until vendor impls are wired.

const vendorRegistry = new VendorOrderClientRegistry();

// ── Ordering services ─────────────────────────────────────────────────────────

const feePercent = parseFloat(process.env['PLATFORM_FEE_PERCENT'] ?? '0.02');

const ordering = composeOrdering({ db, paymentProvider, vendorRegistry, feePercent });

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env['PORT'] ?? 5050;

app.use(cors());

// Webhook route must use raw body — mount BEFORE express.json().
app.use('/webhooks/payment', paymentWebhookRouter(paymentProvider, ordering.payments));

app.use(express.json());

// Existing routes
import { default as listingsRouter } from './routes/listings';
import { default as fitmentRouter } from './routes/fitment';
app.use('/listings', listingsRouter);
app.use('/fitment', fitmentRouter);

// Checkout routes
app.use('/checkout', checkoutRouter(ordering.checkout));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
