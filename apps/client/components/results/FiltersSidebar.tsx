'use client';

import { useCallback } from 'react';
import { X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { VendorDTO } from '@/lib/types';
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
  vendors: VendorDTO[];
  className?: string;
}

export default function FiltersSidebar({ vendors, className }: FiltersSidebarProps) {
  const router = useRouter();
  const params = useSearchParams();

  const partType = params.get('partType') ?? '';
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
      // Reset cursor on filter change
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
              checked={selectedVendors.includes(v.id)}
              onChange={() => toggleList('vendorId', selectedVendors, v.id)}
            />
          ))}
        </FilterSection>
      )}
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
