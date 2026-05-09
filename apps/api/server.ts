import express = require('express');
import cors = require('cors');
import dotenv = require('dotenv');

dotenv.config();

const listingsRouter = require('./routes/listings');
const fitmentRouter = require('./routes/fitment');
const checkoutRouter = require('./routes/checkout');
const paymentWebhookRouter = require('./routes/paymentWebhook');

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env['PORT'] ?? 5050;

app.use(cors());

// Webhook route must use raw body — mount BEFORE express.json().
app.use('/webhooks/payment', paymentWebhookRouter);

app.use(express.json());

// Existing routes
app.use('/listings', listingsRouter);
app.use('/fitment', fitmentRouter);

// Checkout routes
app.use('/checkout', checkoutRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
