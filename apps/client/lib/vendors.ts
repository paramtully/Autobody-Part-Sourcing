import type { VendorDTO } from './types';

/** Collapse regional variants (e.g. ebay-us + ebay-ca) that share a display name. */
export function uniqueVendorsByName(vendors: VendorDTO[]): VendorDTO[] {
  const seen = new Set<string>();
  return vendors.filter(v => {
    const key = v.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
