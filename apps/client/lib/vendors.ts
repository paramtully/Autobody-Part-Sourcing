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

export type VendorFilterOption = VendorDTO & { filterVendorIds: string[] };

/** One filter row per display name; regional duplicates share filterVendorIds. */
export function vendorsForFilter(vendors: VendorDTO[]): VendorFilterOption[] {
  const byName = new Map<string, VendorFilterOption>();
  for (const v of vendors) {
    const key = v.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.filterVendorIds.push(v.id);
    } else {
      byName.set(key, { ...v, filterVendorIds: [v.id] });
    }
  }
  return [...byName.values()];
}
