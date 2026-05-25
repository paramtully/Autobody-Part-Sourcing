'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatFreshness } from '@/lib/formatters';
import { cn } from '@/lib/cn';

interface FreshnessChipProps {
  isoDate: string | null | undefined;
  onRefresh?: () => void;
  className?: string;
}

export default function FreshnessChip({ isoDate, onRefresh, className }: FreshnessChipProps) {
  const [label, setLabel] = useState(() => formatFreshness(isoDate));

  // Update the relative time label every minute
  useEffect(() => {
    setLabel(formatFreshness(isoDate));
    const interval = setInterval(() => setLabel(formatFreshness(isoDate)), 60_000);
    return () => clearInterval(interval);
  }, [isoDate]);

  return (
    <button
      onClick={onRefresh}
      disabled={!onRefresh}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] text-[#475569] bg-[#F7F8FA] border border-[#E5E7EB] rounded-md px-2 py-1 transition-colors',
        onRefresh ? 'hover:bg-[#EEF2F7] cursor-pointer' : 'cursor-default',
        className,
      )}
      aria-label="Inventory freshness"
    >
      <RefreshCw size={10} />
      <span>{label}</span>
    </button>
  );
}
