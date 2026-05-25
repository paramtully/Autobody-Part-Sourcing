import { AffiliateLinkBuilder } from '../affiliateLinkBuilder';

const EBAY_HOST_RE = /^https?:\/\/(www\.)?ebay\.(com|ca)\//i;

export class EbayAffiliateLinkBuilder implements AffiliateLinkBuilder {
    readonly vendorId = 'ebay';
    readonly enabled: boolean;
    private readonly mkrid?: string;
    private readonly campid?: string;

    constructor() {
        this.mkrid  = process.env.EBAY_EPN_MKRID;
        this.campid = process.env.EBAY_EPN_CAMPID;
        this.enabled = !!(this.mkrid && this.campid);
    }

    wrap(canonicalUrl: string): string | null {
        if (!this.enabled) return null;
        if (!EBAY_HOST_RE.test(canonicalUrl)) return null;
        return `https://rover.ebay.com/rover/1/${this.mkrid}/1`
            + `?icep_id=114&ipn=psmain&icep_vectorid=229466`
            + `&toolid=10001&campid=${this.campid}&mpre=${encodeURIComponent(canonicalUrl)}`;
    }
}
