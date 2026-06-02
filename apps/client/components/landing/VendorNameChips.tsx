'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchVendors } from '@/lib/api';
import { uniqueVendorsByName } from '@/lib/vendors';

export default function VendorNameChips() {
  const { data, isPending } = useQuery({
    queryKey: ['vendors'],
    queryFn: fetchVendors,
    staleTime: 5 * 60_000,
  });

  const displayVendors = uniqueVendorsByName(data?.vendors ?? []);

  if (isPending || displayVendors.length === 0) {
    return <span className="text-[12px] text-[#94A3B8]">Loading vendor list…</span>;
  }

  return (
    <>
      {displayVendors.map(v => (
        <span
          key={v.name}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#F7F8FA] border border-[#E5E7EB] rounded-md text-[12px] font-medium text-[#475569]"
        >
          <span
            className={`inline-block w-2 h-2 rounded-full ${v.vendorType === 'OEM' ? 'bg-blue-500' : v.vendorType === 'SALVAGE' ? 'bg-amber-500' : 'bg-green-500'}`}
          />
          {v.name}
        </span>
      ))}
    </>
  );
}
