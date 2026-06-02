import AffiliateLinkBuilder from '../../affiliateLinkBuilder.js';

const ITM_ID_RE = /\/itm\/(\d+)/i;
const ROVER_MPRE_RE = /[?&]mpre=([^&]+)/i;

const EPN_MKRID_BY_TLD = {
    com: '711-53200-19255-0',
    ca: '706-53473-19255-0',
} as const;

export type EbayVendorId = 'ebay-us' | 'ebay-ca';

/** Strip tracking params and rebuild a clean /itm/{id} URL. */
export function normalizeEbayCanonicalUrl(url: string): string | null {
    let target = url.trim();
    if (/^https?:\/\/rover\.ebay\.com/i.test(target)) {
        const m = target.match(ROVER_MPRE_RE);
        if (!m?.[1]) return null;
        target = decodeURIComponent(m[1]);
    }

    let parsed: URL;
    try {
        parsed = new URL(target);
    } catch {
        return null;
    }

    if (!/(?:^|\.)ebay\.(com|ca)$/i.test(parsed.hostname)) return null;
    const tld = parsed.hostname.toLowerCase().endsWith('.ca') ? 'ca' : 'com';
    const itemMatch = parsed.pathname.match(ITM_ID_RE);
    if (!itemMatch?.[1]) return null;

    return `https://www.ebay.${tld}/itm/${itemMatch[1]}`;
}

function mkridForNormalizedUrl(normalized: string): string | null {
    if (normalized.includes('ebay.ca')) return EPN_MKRID_BY_TLD.ca;
    if (normalized.includes('ebay.com')) return EPN_MKRID_BY_TLD.com;
    return null;
}

export default class EbayAffiliateLinkBuilder implements AffiliateLinkBuilder {
    readonly vendorId: EbayVendorId;
    readonly enabled: boolean;
    private readonly campid: string | undefined;

    constructor(vendorId: EbayVendorId) {
        this.vendorId = vendorId;
        this.campid = process.env.EBAY_EPN_CAMPID;
        this.enabled = !!this.campid;
    }

    wrap(canonicalUrl: string): string | null {
        if (!this.enabled || !this.campid) return null;

        const normalized = normalizeEbayCanonicalUrl(canonicalUrl);
        if (!normalized) return null;

        const mkrid = mkridForNormalizedUrl(normalized);
        if (!mkrid) return null;

        const u = new URL(normalized);
        u.searchParams.set('mkevt', '1');
        u.searchParams.set('mkcid', '1');
        u.searchParams.set('mkrid', mkrid);
        u.searchParams.set('campid', this.campid);
        u.searchParams.set('toolid', '10001');
        return u.toString();
    }
}
