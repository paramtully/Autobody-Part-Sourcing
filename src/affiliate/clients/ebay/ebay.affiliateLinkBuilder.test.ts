import EbayAffiliateLinkBuilder, {
    normalizeEbayCanonicalUrl,
    type EbayVendorId,
} from './ebay.affiliateLinkBuilder';

const MKRID_US = '711-53200-19255-0';
const MKRID_CA = '706-53473-19255-0';
const CAMPID = '5338123456';
const CA_URL = 'https://www.ebay.ca/itm/123456789';
const US_URL = 'https://www.ebay.com/itm/987654321';
const CA_URL_WITH_HASH =
    'https://www.ebay.ca/itm/225790420905?hash=item34922867a9:g:zA0AAOSwCcZlL5T8';

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

describe('normalizeEbayCanonicalUrl', () => {
    it('strips hash and query params from item URLs', () => {
        expect(normalizeEbayCanonicalUrl(CA_URL_WITH_HASH)).toBe(
            'https://www.ebay.ca/itm/225790420905',
        );
    });

    it('extracts mpre from legacy rover links', () => {
        const rover =
            `https://rover.ebay.com/rover/1/${MKRID_CA}/1?mpre=${encodeURIComponent(CA_URL_WITH_HASH)}`;
        expect(normalizeEbayCanonicalUrl(rover)).toBe('https://www.ebay.ca/itm/225790420905');
    });

    it('returns null for non-eBay URLs', () => {
        expect(normalizeEbayCanonicalUrl('https://lkqcorp.com/part/123')).toBeNull();
    });
});

describe('EbayAffiliateLinkBuilder', () => {
    it('is disabled and returns null when EPN campid is missing', () => {
        const builder = makeBuilder('ebay-ca', false);
        expect(builder.enabled).toBe(false);
        expect(builder.wrap(CA_URL)).toBeNull();
    });

    it('appends direct EPN params on ebay.ca (not rover)', () => {
        const result = makeBuilder('ebay-ca').wrap(CA_URL)!;
        const url = new URL(result);
        expect(url.hostname).toBe('www.ebay.ca');
        expect(url.pathname).toBe('/itm/123456789');
        expect(url.searchParams.get('mkevt')).toBe('1');
        expect(url.searchParams.get('mkcid')).toBe('1');
        expect(url.searchParams.get('mkrid')).toBe(MKRID_CA);
        expect(url.searchParams.get('campid')).toBe(CAMPID);
        expect(url.searchParams.get('toolid')).toBe('10001');
        expect(result).not.toContain('rover.ebay.com');
        expect(result).not.toContain('hash=');
    });

    it('uses US mkrid for ebay.com URLs even when builder is ebay-ca', () => {
        const result = makeBuilder('ebay-ca').wrap(US_URL)!;
        expect(new URL(result).searchParams.get('mkrid')).toBe(MKRID_US);
    });

    it('uses CA mkrid for ebay.ca URLs when builder is ebay-us', () => {
        const result = makeBuilder('ebay-us').wrap(CA_URL)!;
        expect(new URL(result).searchParams.get('mkrid')).toBe(MKRID_CA);
    });

    it('normalizes hash URLs before wrapping', () => {
        const result = makeBuilder('ebay-ca').wrap(CA_URL_WITH_HASH)!;
        expect(result).not.toContain('hash=');
        expect(new URL(result).searchParams.get('mkrid')).toBe(MKRID_CA);
    });

    it('returns null for non-eBay URLs', () => {
        const builder = makeBuilder('ebay-us');
        expect(builder.wrap('https://lkqcorp.com/part/123')).toBeNull();
        expect(builder.wrap('https://evil.com/ebay.ca/fake')).toBeNull();
    });
});
