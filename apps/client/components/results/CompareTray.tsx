'use client';

import { useRouter } from 'next/navigation';
import { X, GitCompare, ChevronDown } from 'lucide-react';
import { useCompareStore } from '@/store/compareStore';
import { formatPriceShort } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import { useState } from 'react';

export default function CompareTray() {
  const { selected, remove, clear } = useCompareStore();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  if (selected.length === 0) return null;

  const handleCompare = () => {
    const ids = selected.map(l => l.id).join(',');
    router.push(`/compare?ids=${ids}`);
  };

  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 right-0 z-30 bg-[#111827] text-white border-t border-white/10 transition-all no-print',
      )}
    >
      <div className="max-w-[1400px] mx-auto px-6">
        {/* Collapsed pill */}
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="py-2 flex items-center gap-2 text-[13px] font-medium w-full"
          >
            <GitCompare size={14} />
            <span>Compare ({selected.length} selected)</span>
            <ChevronDown size={13} className="rotate-180" />
          </button>
        ) : (
          <div className="py-3 flex items-center gap-4">
            {/* Selected items */}
            <div className="flex items-center gap-3 flex-1 overflow-x-auto">
              {selected.map(listing => (
                <div
                  key={listing.id}
                  className="flex items-center gap-2 bg-white/10 rounded-md px-2.5 py-1.5 shrink-0"
                >
                  <div className="text-[12px] leading-tight">
                    <p className="font-medium truncate max-w-[120px]">{listing.partName}</p>
                    <p className="text-white/60 mono text-[11px]">{listing.partNumber}</p>
                    <p className="text-white/80 num text-[11px]">
                      {formatPriceShort(listing.priceMinorMin, listing.currency)}
                    </p>
                  </div>
                  <button
                    onClick={() => remove(listing.id)}
                    className="ml-1 hover:text-white/60 transition-colors"
                    aria-label={`Remove ${listing.partName} from comparison`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}

              {selected.length < 4 && (
                <p className="text-white/40 text-[12px] shrink-0">
                  Add up to {4 - selected.length} more
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => setCollapsed(true)}
                className="text-white/60 hover:text-white transition-colors"
                aria-label="Collapse compare tray"
              >
                <ChevronDown size={14} />
              </button>
              <button
                onClick={clear}
                className="text-[12px] text-white/60 hover:text-white transition-colors"
              >
                Clear
              </button>
              <button
                onClick={handleCompare}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#D97706] text-white text-[13px] font-semibold hover:bg-[#B45309] transition-colors"
              >
                <GitCompare size={13} />
                Compare ({selected.length})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
