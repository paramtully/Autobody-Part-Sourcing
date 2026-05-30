// Stub environment variables before any module loads dotenv.
// This file runs during Jest's setupFiles phase, before test imports.
// When LIVE_TESTS=1, load .env first — @repo/db/client throws if DATABASE_URL is unset
// and many modules import @repo/db before their own dotenv.config() runs.
import { config as loadEnv } from 'dotenv';

const live = process.env['LIVE_TESTS'] === '1';

if (live) {
    loadEnv();
} else {
    process.env['DATABASE_URL'] = 'memory://test';
    process.env['EBAY_API_KEY'] = 'test-ebay-key';
    process.env['EBAY_API_SECRET'] = 'test-ebay-secret';
    process.env['EBAY_API_URL'] = 'https://api.ebay.com';
    process.env['LKQ_API_KEY'] = 'test-lkq-key';
    process.env['LKQ_API_SECRET'] = 'test-lkq-secret';
}
