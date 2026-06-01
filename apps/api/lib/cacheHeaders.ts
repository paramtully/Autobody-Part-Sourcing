import type { Response } from 'express';

export const STATIC_CACHE_CONTROL = 'public, s-maxage=3600, stale-while-revalidate=86400';

export function setStaticCacheHeaders(res: Response): void {
    res.setHeader('Cache-Control', STATIC_CACHE_CONTROL);
}
