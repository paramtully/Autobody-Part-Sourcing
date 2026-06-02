import { vendorsForFilter } from './vendors';
import type { VendorDTO } from './types';

describe('vendorsForFilter', () => {
  it('merges regional eBay vendors into one filter option', () => {
    const vendors: VendorDTO[] = [
      { id: 'ebay-us', name: 'eBay', vendorType: 'MARKETPLACE', reliabilityScore: null, orderContactEmail: null },
      { id: 'ebay-ca', name: 'eBay', vendorType: 'MARKETPLACE', reliabilityScore: null, orderContactEmail: null },
      { id: 'lkq', name: 'LKQ', vendorType: 'MARKETPLACE', reliabilityScore: null, orderContactEmail: null },
    ];
    const result = vendorsForFilter(vendors);
    expect(result).toHaveLength(2);
    const ebay = result.find(v => v.name === 'eBay')!;
    expect(ebay.filterVendorIds).toEqual(expect.arrayContaining(['ebay-us', 'ebay-ca']));
    expect(ebay.filterVendorIds).toHaveLength(2);
  });
});
