import { AffiliateLinkBuilder } from './affiliateLinkBuilder';
import { EbayAffiliateLinkBuilder } from './builders/ebay.affiliateLinkBuilder';

const NOOP: AffiliateLinkBuilder = { vendorId: 'noop', enabled: false, wrap: () => null };

const builders = new Map<string, AffiliateLinkBuilder>([
    ['ebay', new EbayAffiliateLinkBuilder()],
]);

export function getAffiliateBuilder(vendorId: string): AffiliateLinkBuilder {
    return builders.get(vendorId) ?? NOOP;
}
