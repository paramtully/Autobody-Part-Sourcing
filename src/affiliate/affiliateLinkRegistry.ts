import type { AffiliateLinkBuilder } from './affiliateLinkBuilder.js';
import EbayAffiliateLinkBuilder from './clients/ebay/ebay.affiliateLinkBuilder.js';

const NOOP: AffiliateLinkBuilder = { vendorId: 'noop', enabled: false, wrap: () => null };

const ebayBuilder = new EbayAffiliateLinkBuilder();
const builders = new Map<string, AffiliateLinkBuilder>([
    ['ebay-us', ebayBuilder],
    ['ebay-ca', ebayBuilder],
]);

export default function getAffiliateBuilder(vendorId: string): AffiliateLinkBuilder {
    return builders.get(vendorId) ?? NOOP;
}