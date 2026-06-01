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

function corsOrigins(): string[] {
    const origins = ['http://localhost:3000'];
    const domain = process.env['DOMAIN_NAME']?.trim();
    if (domain) {
        origins.push(`https://${domain}`, `https://www.${domain}`);
    }
    return origins;
}

app.use(
    cors({
        origin(origin, callback) {
            if (!origin || corsOrigins().includes(origin)) {
                callback(null, true);
                return;
            }
            callback(null, false);
        },
    }),
);

// Webhook route must use raw body — mount BEFORE express.json().
// app.use('/webhooks/payment', paymentWebhookRouter);

app.use(express.json());

app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
});

app.use('/listings', listingsRouter);
app.use('/fitment', fitmentRouter);
app.use('/vendors', vendorsRouter);
// app.use('/checkout', checkoutRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
});

// Vercel @vercel/node invokes the exported app; listen only for local dev.
export default app;

if (!process.env['VERCEL']) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
