/**
 * Live smoke: wrapped affiliate URLs must not redirect to eBay error pages.
 * Run: LIVE_TESTS=1 EBAY_EPN_CAMPID=... npm run test:live
 */

import EbayAffiliateLinkBuilder from './ebay.affiliateLinkBuilder';

const LIVE = process.env.LIVE_TESTS === '1';
const CAMPID = process.env.EBAY_EPN_CAMPID;
const describeLive = LIVE && CAMPID ? describe : describe.skip;

describeLive('EbayAffiliateLinkBuilder live', () => {
    const builder = new EbayAffiliateLinkBuilder('ebay-ca');

    it('HEAD on wrapped CA listing returns 200, not /n/error', async () => {
        const wrapped = builder.wrap('https://www.ebay.ca/itm/225790420905')!;
        expect(wrapped).toBeTruthy();
        expect(wrapped).not.toContain('rover.ebay.com');

        const res = await fetch(wrapped, { method: 'HEAD', redirect: 'follow' });
        expect(res.url).not.toMatch(/\/n\/error|page_not_responding/);
        expect(res.status).toBe(200);
    }, 30_000);
});
