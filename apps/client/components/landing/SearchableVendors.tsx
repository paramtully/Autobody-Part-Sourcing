'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchVendors } from '@/lib/api';
import { uniqueVendorsByName } from '@/lib/vendors';

export default function SearchableVendors() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['vendors'],
    queryFn: fetchVendors,
    staleTime: 5 * 60_000,
  });

  const displayVendors = uniqueVendorsByName(data?.vendors ?? []);

  return (
    <div className="bg-[#111827] rounded-xl p-6 text-white">
      <p className="text-[12px] text-white/50 uppercase tracking-wide mb-3">Searchable vendors</p>
      {isPending ? (
        <p className="text-[13px] text-white/40 py-2">Loading vendor list…</p>
      ) : isError || displayVendors.length === 0 ? (
        <p className="text-[13px] text-white/40 py-2">Vendor list unavailable</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(['OEM', 'AFTERMARKET', 'SALVAGE', 'MARKETPLACE'] as const)
            .filter(type => displayVendors.some(v => v.vendorType === type))
            .map(type => (
              <div key={type} className="bg-white/5 rounded-lg p-3">
                <p className="text-[11px] text-white/50 mb-1">{type}</p>
                <p className="text-[13px] font-medium">
                  {displayVendors.filter(v => v.vendorType === type).length} connected
                </p>
              </div>
            ))}
        </div>
      )}
      <p className="text-[11px] text-white/40 mt-4">More vendors added continuously.</p>
    </div>
  );
}
