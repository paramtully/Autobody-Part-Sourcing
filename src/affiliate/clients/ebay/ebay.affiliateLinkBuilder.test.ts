import { EbayAffiliateLinkBuilder } from './ebay.affiliateLinkBuilder';

const MKRID  = '711-53200-19255-0';
const CAMPID = '5338123456';
const CA_URL = 'https://www.ebay.ca/itm/123456789';
const US_URL = 'https://www.ebay.com/itm/987654321';

function makeBuilder(enabled = true): EbayAffiliateLinkBuilder {
    if (enabled) {
        process.env['EBAY_EPN_MKRID']  = MKRID;
        process.env['EBAY_EPN_CAMPID'] = CAMPID;
    } else {
        delete process.env['EBAY_EPN_MKRID'];
        delete process.env['EBAY_EPN_CAMPID'];
    }
    return new EbayAffiliateLinkBuilder();
}

afterEach(() => {
    delete process.env['EBAY_EPN_MKRID'];
    delete process.env['EBAY_EPN_CAMPID'];
});

describe('EbayAffiliateLinkBuilder', () => {
    it('is disabled and returns null when EPN env vars are missing', () => {
        const builder = makeBuilder(false);
        expect(builder.enabled).toBe(false);
        expect(builder.wrap(CA_URL)).toBeNull();
    });

    it('is enabled and wraps ebay.ca URLs with rover prefix', () => {
        const builder = makeBuilder(true);
        expect(builder.enabled).toBe(true);
        const result = builder.wrap(CA_URL);
        expect(result).not.toBeNull();
        expect(result!.startsWith('https://rover.ebay.com/rover/1/')).toBe(true);
        expect(result).toContain(`campid=${CAMPID}`);
    });

    it('wraps ebay.com URLs as well as ebay.ca', () => {
        const result = makeBuilder(true).wrap(US_URL);
        expect(result).not.toBeNull();
        expect(result!.startsWith('https://rover.ebay.com/')).toBe(true);
    });

    it('returns null for non-eBay URLs', () => {
        const builder = makeBuilder(true);
        expect(builder.wrap('https://lkqcorp.com/part/123')).toBeNull();
        expect(builder.wrap('https://evil.com/ebay.ca/fake')).toBeNull();
    });

    it('encodes the canonical URL in mpre without double-encoding', () => {
        const builder = makeBuilder(true);
        const wrapped = builder.wrap(CA_URL)!;
        const url = new URL(wrapped);
        const mpre = url.searchParams.get('mpre');
        expect(mpre).toBe(CA_URL);
    });
});
