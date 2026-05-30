import EbayAffiliateLinkBuilder, { type EbayVendorId } from './ebay.affiliateLinkBuilder';

const MKRID_US = '711-53200-19255-0';
const MKRID_CA = '706-53473-19255-0';
const CAMPID = '5338123456';
const CA_URL = 'https://www.ebay.ca/itm/123456789';
const US_URL = 'https://www.ebay.com/itm/987654321';

function makeBuilder(vendorId: EbayVendorId, enabled = true): EbayAffiliateLinkBuilder {
    if (enabled) {
        process.env['EBAY_EPN_CAMPID'] = CAMPID;
    } else {
        delete process.env['EBAY_EPN_CAMPID'];
    }
    return new EbayAffiliateLinkBuilder(vendorId);
}

afterEach(() => {
    delete process.env['EBAY_EPN_CAMPID'];
});

describe('EbayAffiliateLinkBuilder', () => {
    it('is disabled and returns null when EPN campid is missing', () => {
        const builder = makeBuilder('ebay-ca', false);
        expect(builder.enabled).toBe(false);
        expect(builder.wrap(CA_URL)).toBeNull();
    });

    it('uses CA MKRID for ebay-ca vendor', () => {
        const result = makeBuilder('ebay-ca').wrap(CA_URL)!;
        expect(result).toContain(`/rover/1/${MKRID_CA}/1`);
        expect(result).toContain(`campid=${CAMPID}`);
    });

    it('uses US MKRID for ebay-us vendor', () => {
        const result = makeBuilder('ebay-us').wrap(US_URL)!;
        expect(result).toContain(`/rover/1/${MKRID_US}/1`);
        expect(result).toContain(`campid=${CAMPID}`);
    });

    it('wraps ebay.com and ebay.ca URLs when enabled', () => {
        expect(makeBuilder('ebay-us').wrap(US_URL)).toMatch(/^https:\/\/rover\.ebay\.com\//);
        expect(makeBuilder('ebay-ca').wrap(CA_URL)).toMatch(/^https:\/\/rover\.ebay\.com\//);
    });

    it('returns null for non-eBay URLs', () => {
        const builder = makeBuilder('ebay-us');
        expect(builder.wrap('https://lkqcorp.com/part/123')).toBeNull();
        expect(builder.wrap('https://evil.com/ebay.ca/fake')).toBeNull();
    });

    it('encodes the canonical URL in mpre without double-encoding', () => {
        const wrapped = makeBuilder('ebay-ca').wrap(CA_URL)!;
        const url = new URL(wrapped);
        expect(url.searchParams.get('mpre')).toBe(CA_URL);
    });
});
