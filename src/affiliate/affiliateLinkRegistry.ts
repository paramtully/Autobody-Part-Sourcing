import type { AffiliateLinkBuilder } from './affiliateLinkBuilder.js';
import EbayAffiliateLinkBuilder from './clients/ebay/ebay.affiliateLinkBuilder.js';

const NOOP: AffiliateLinkBuilder = { vendorId: 'noop', enabled: false, wrap: () => null };

const builders = new Map<string, AffiliateLinkBuilder>([
    ['ebay-us', new EbayAffiliateLinkBuilder('ebay-us')],
    ['ebay-ca', new EbayAffiliateLinkBuilder('ebay-ca')],
]);

export default function getAffiliateBuilder(vendorId: string): AffiliateLinkBuilder {
    return builders.get(vendorId) ?? NOOP;
}
