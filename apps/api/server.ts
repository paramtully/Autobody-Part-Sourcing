import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import listingsRouter from './routes/listings.js';
import fitmentRouter from './routes/fitment.js';
import vendorsRouter from './routes/vendors.js';
import { corsOrigins, isOriginExemptPath, isProductionApi } from './lib/allowedOrigins.js';
// import checkoutRouter from './routes/checkout.js';
// import paymentWebhookRouter from './routes/paymentWebhook.js';

const app = express();
const PORT = process.env['PORT'] ?? 5050;

app.use((req, res, next) => {
    if (!isProductionApi() || isOriginExemptPath(req.path)) {
        next();
        return;
    }
    const origin = req.headers.origin;
    if (!origin || !corsOrigins().includes(origin)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    next();
});

app.use(
    cors({
        origin(origin, callback) {
            if (!isProductionApi()) {
                if (!origin || corsOrigins().includes(origin)) {
                    callback(null, true);
                    return;
                }
                callback(null, false);
                return;
            }
            // Non-CORS requests have no Origin; the Origin gate middleware already
            // returns 403 on protected paths before we reach route handlers.
            if (!origin) {
                callback(null, true);
                return;
            }
            if (corsOrigins().includes(origin)) {
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
