/** Browser origins allowed to call the API (CORS + production Origin gate). */
export function corsOrigins(): string[] {
    const origins = ['http://localhost:3000'];
    const domain = process.env['DOMAIN_NAME']?.trim();
    if (domain) {
        origins.push(`https://${domain}`, `https://www.${domain}`);
    }
    return origins;
}

export function isProductionApi(): boolean {
    return Boolean(process.env['VERCEL']) || process.env['NODE_ENV'] === 'production';
}

/** Paths that must work without a browser Origin (health checks, Stripe webhooks). */
export function isOriginExemptPath(path: string): boolean {
    if (path === '/health') return true;
    if (path.startsWith('/webhooks/payment')) return true;
    return false;
}
