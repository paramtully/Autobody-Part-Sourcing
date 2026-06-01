/**
 * Production Origin gate on the full Express app.
 */

import request from 'supertest';

const VERCEL_ENV = process.env.VERCEL;
const DOMAIN_ENV = process.env.DOMAIN_NAME;

afterEach(() => {
  if (VERCEL_ENV === undefined) {
    delete process.env.VERCEL;
  } else {
    process.env.VERCEL = VERCEL_ENV;
  }
  if (DOMAIN_ENV === undefined) {
    delete process.env.DOMAIN_NAME;
  } else {
    process.env.DOMAIN_NAME = DOMAIN_ENV;
  }
  jest.resetModules();
});

describe('production Origin gate', () => {
  it('GET /health — allowed without Origin', async () => {
    process.env.VERCEL = '1';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const app = require('./server').default;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('GET /vendors — 403 without Origin in production', async () => {
    process.env.VERCEL = '1';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const app = require('./server').default;
    const res = await request(app).get('/vendors');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });
});
