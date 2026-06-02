'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CurrencyFilter } from '@/lib/types';
import type { VendorFilterOption } from '@/lib/vendors';
import { cn } from '@/lib/cn';

const CONDITIONS = [
  { value: 'NEW_OEM', label: 'New OEM' },
  { value: 'NEW_AFTERMARKET', label: 'New Aftermarket' },
  { value: 'RECYCLED', label: 'Recycled' },
  { value: 'REMANUFACTURED', label: 'Remanufactured' },
  { value: 'RECONDITIONED', label: 'Reconditioned' },
];

const AVAILABILITY = [
  { value: 'IN_STOCK', label: 'In stock' },
  { value: 'LOW_STOCK', label: 'Low stock' },
  { value: 'BACKORDER', label: 'Backorder' },
];

interface FiltersSidebarProps {
  vendors: VendorFilterOption[];
  className?: string;
}

export default function FiltersSidebar({ vendors, className }: FiltersSidebarProps) {
  const router = useRouter();
  const params = useSearchParams();

  const partType = params.get('partType') ?? '';
  const currency = (params.get('currency') ?? 'CAD') as CurrencyFilter;
  const conditionRaw = params.get('condition') ?? '';
  const vendorIdRaw = params.get('vendorId') ?? '';
  const availabilityRaw = params.get('availability') ?? '';

  const selectedConditions = conditionRaw ? conditionRaw.split(',') : [];
  const selectedVendors = vendorIdRaw ? vendorIdRaw.split(',') : [];
  const selectedAvailability = availabilityRaw ? availabilityRaw.split(',') : ['IN_STOCK', 'LOW_STOCK'];

  const updateParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('cursor');
      router.push(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const toggleList = useCallback(
    (key: string, current: string[], value: string) => {
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      updateParam(key, next.join(','));
    },
    [updateParam],
  );

  const toggleVendorGroup = useCallback(
    (filterVendorIds: string[]) => {
      const allSelected = filterVendorIds.every(id => selectedVendors.includes(id));
      const next = allSelected
        ? selectedVendors.filter(id => !filterVendorIds.includes(id))
        : [...new Set([...selectedVendors, ...filterVendorIds])];
      updateParam('vendorId', next.join(','));
    },
    [selectedVendors, updateParam],
  );

  // Region is sticky context — not a filter — so it never contributes to hasFilters
  // and is excluded from Reset.
  const setRegion = useCallback(
    (value: CurrencyFilter) => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('region', value);
      }
      updateParam('currency', value);
    },
    [updateParam],
  );

  const hasFilters = partType || conditionRaw || vendorIdRaw || availabilityRaw;

  return (
    <aside className={cn('w-56 shrink-0 text-[13px]', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="font-semibold text-[#0B1220] text-[13px]">Filters</span>
        {hasFilters && (
          <button
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              ['partType', 'condition', 'vendorId', 'availability'].forEach(k => next.delete(k));
              router.push(`?${next.toString()}`, { scroll: false });
            }}
            className="text-[#1F6FEB] text-[12px] hover:underline"
          >
            Reset
          </button>
        )}
      </div>

      {/* Part type */}
      <FilterSection title="Part type">
        <div className="flex gap-2">
          {(['', 'OEM', 'AFTERMARKET'] as const).map(v => (
            <button
              key={v || 'all'}
              onClick={() => updateParam('partType', v)}
              className={cn(
                'px-2 py-1 rounded text-[12px] font-medium border transition-colors',
                partType === v
                  ? 'bg-[#1F6FEB] text-white border-[#1F6FEB]'
                  : 'bg-white text-[#475569] border-[#E5E7EB] hover:border-[#CBD5E1]',
              )}
            >
              {v || 'All'}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* Availability */}
      <FilterSection title="Availability">
        {AVAILABILITY.map(({ value, label }) => (
          <CheckItem
            key={value}
            label={label}
            checked={selectedAvailability.includes(value)}
            onChange={() => toggleList('availability', selectedAvailability, value)}
          />
        ))}
      </FilterSection>

      {/* Condition */}
      <FilterSection title="Condition">
        {CONDITIONS.map(({ value, label }) => (
          <CheckItem
            key={value}
            label={label}
            checked={selectedConditions.includes(value)}
            onChange={() => toggleList('condition', selectedConditions, value)}
          />
        ))}
      </FilterSection>

      {/* Vendor */}
      {vendors.length > 0 && (
        <FilterSection title="Vendor">
          {vendors.map(v => (
            <CheckItem
              key={v.id}
              label={v.name}
              sublabel={v.vendorType}
              checked={v.filterVendorIds.every(id => selectedVendors.includes(id))}
              onChange={() => toggleVendorGroup(v.filterVendorIds)}
            />
          ))}
        </FilterSection>
      )}

      {/* Region — sticky preference, not a filter. Lives at the bottom so it stays
          out of the way during normal searching but is easy to find when needed. */}
      <div className="mt-6 pt-5 border-t border-[#E5E7EB]">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8] mb-2">Region</p>
        <div className="bg-[#F1F5F9] p-1 rounded-lg flex">
          {([
            { value: 'CAD', label: 'Canada' },
            { value: 'USD', label: 'United States' },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setRegion(value)}
              className={cn(
                'flex-1 px-3 py-1.5 rounded text-[12px] font-medium transition-colors',
                currency === value
                  ? 'bg-white text-[#0B1220] shadow-sm'
                  : 'text-[#475569] hover:text-[#0B1220]',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8] mb-2">{title}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function CheckItem({
  label,
  sublabel,
  checked,
  onChange,
}: {
  label: string;
  sublabel?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="rounded border-[#CBD5E1] text-[#1F6FEB] focus:ring-[#1F6FEB] focus:ring-1"
      />
      <span className="text-[#0B1220] group-hover:text-[#1F6FEB] transition-colors">
        {label}
        {sublabel && <span className="text-[#94A3B8] ml-1 text-[11px]">{sublabel}</span>}
      </span>
    </label>
  );
}
