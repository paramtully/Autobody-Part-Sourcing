'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Rows3, Rows2, ArrowUpDown } from 'lucide-react';
import FreshnessChip from '@/components/shared/FreshnessChip';
import { cn } from '@/lib/cn';
import type { Density } from '@/lib/useDensity';
import type { SortOption } from '@/lib/types';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'best_match', label: 'Best match' },
  { value: 'price_asc', label: 'Price ↑' },
  { value: 'price_desc', label: 'Price ↓' },
  { value: 'eta_asc', label: 'Fastest ETA' },
  { value: 'reliability_desc', label: 'Most reliable' },
];

interface ResultsToolbarProps {
  totalCount?: number;
  oldestFreshnessDate: string | null;
  onRefresh?: () => void;
  density: Density;
  onDensityChange: (d: Density) => void;
  searchSummary: string;
}

export default function ResultsToolbar({
  totalCount,
  oldestFreshnessDate,
  onRefresh,
  density,
  onDensityChange,
  searchSummary,
}: ResultsToolbarProps) {
  const router = useRouter();
  const params = useSearchParams();
  const currentSort = (params.get('sort') as SortOption) ?? 'best_match';

  const handleSort = (sort: SortOption) => {
    const next = new URLSearchParams(params.toString());
    next.set('sort', sort);
    next.delete('cursor');
    router.push(`?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="sticky top-12 z-20 bg-[#FAFBFC] border-b border-[#E5E7EB] px-6 py-2.5 flex items-center gap-3 flex-wrap no-print">
      {/* Search summary */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-[13px] font-medium text-[#0B1220] truncate">{searchSummary}</span>
        {totalCount !== undefined && (
          <span className="text-[12px] text-[#94A3B8] shrink-0">
            ({totalCount} {totalCount === 1 ? 'result' : 'results'})
          </span>
        )}
      </div>

      {/* Freshness */}
      <FreshnessChip isoDate={oldestFreshnessDate} onRefresh={onRefresh} />

      {/* Sort */}
      <div className="flex items-center gap-1.5">
        <ArrowUpDown size={13} className="text-[#94A3B8]" />
        <select
          value={currentSort}
          onChange={e => handleSort(e.target.value as SortOption)}
          className="text-[12px] border border-[#E5E7EB] rounded-md px-2 py-1 bg-white text-[#0B1220] focus:ring-1 focus:ring-[#1F6FEB] focus:outline-none"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Density toggle */}
      <div className="flex items-center border border-[#E5E7EB] rounded-md overflow-hidden">
        <DensityButton active={density === 'default'} onClick={() => onDensityChange('default')} title="Normal density">
          <Rows3 size={13} />
        </DensityButton>
        <DensityButton active={density === 'compact'} onClick={() => onDensityChange('compact')} title="Compact density">
          <Rows2 size={13} />
        </DensityButton>
      </div>
    </div>
  );
}

function DensityButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'px-2 py-1.5 transition-colors',
        active ? 'bg-[#EEF2F7] text-[#1F6FEB]' : 'bg-white text-[#94A3B8] hover:text-[#0B1220]',
      )}
    >
      {children}
    </button>
  );
}
