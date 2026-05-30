import AffiliateLinkBuilder from '../../affiliateLinkBuilder.js';

const EBAY_HOST_RE = /^https?:\/\/(www\.)?ebay\.(com|ca)\//i;

const EPN_MKRID: Record<'ebay-us' | 'ebay-ca', string> = {
    'ebay-us': '711-53200-19255-0',
    'ebay-ca': '706-53473-19255-0',
};

export type EbayVendorId = keyof typeof EPN_MKRID;

export default class EbayAffiliateLinkBuilder implements AffiliateLinkBuilder {
    readonly vendorId: EbayVendorId;
    readonly enabled: boolean;
    private readonly mkrid: string;
    private readonly campid: string | undefined;

    constructor(vendorId: EbayVendorId) {
        this.vendorId = vendorId;
        this.mkrid = EPN_MKRID[vendorId];
        this.campid = process.env.EBAY_EPN_CAMPID;
        this.enabled = !!this.campid;
    }

    wrap(canonicalUrl: string): string | null {
        if (!this.enabled) return null;
        if (!EBAY_HOST_RE.test(canonicalUrl)) return null;
        return `https://rover.ebay.com/rover/1/${this.mkrid}/1`
            + `?icep_id=114&ipn=psmain&icep_vectorid=229466`
            + `&toolid=10001&campid=${this.campid}&mpre=${encodeURIComponent(canonicalUrl)}`;
    }
}
