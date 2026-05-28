import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import listingsRouter from './routes/listings.js';
import fitmentRouter from './routes/fitment.js';
import vendorsRouter from './routes/vendors.js';
// import checkoutRouter from './routes/checkout.js';
// import paymentWebhookRouter from './routes/paymentWebhook.js';

const app = express();
const PORT = process.env['PORT'] ?? 5050;

app.use(cors());

// Webhook route must use raw body — mount BEFORE express.json().
// app.use('/webhooks/payment', paymentWebhookRouter);

app.use(express.json());

app.use('/listings', listingsRouter);
app.use('/fitment', fitmentRouter);
app.use('/vendors', vendorsRouter);
// app.use('/checkout', checkoutRouter);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
