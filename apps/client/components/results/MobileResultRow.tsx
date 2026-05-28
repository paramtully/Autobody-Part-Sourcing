'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ExternalLink } from 'lucide-react';
import type { ListingDTO } from '@/lib/types';
import StatusDot from '@/components/shared/StatusDot';
import ConditionBadge from './ConditionBadge';
import CopyAsQuoteLineButton from './CopyAsQuoteLineButton';
import { formatPrice, formatEta, reliabilityLabel } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import { useCompareStore } from '@/store/compareStore';
import PartNumber from '@/components/shared/PartNumber';

interface MobileResultRowProps {
  listing: ListingDTO;
  rank?: 1 | 2 | 3;
}

export default function MobileResultRow({ listing, rank }: MobileResultRowProps) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const { toggle, isSelected } = useCompareStore();
  const selected = isSelected(listing.id);

  return (
    <div className={cn('border-b border-[#E5E7EB] last:border-0', selected && 'bg-blue-50/40')}>
      {/* Summary row — always visible */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-[#F7F8FA] transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={e => { e.stopPropagation(); toggle(listing); }}
          className="rounded border-[#CBD5E1] text-[#1F6FEB] focus:ring-[#1F6FEB] shrink-0"
          onClick={e => e.stopPropagation()}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[13px] font-medium text-[#0B1220] truncate">{listing.partName}</span>
            {rank === 1 && <span className="text-[9px] text-amber-600 font-bold shrink-0">★ BEST</span>}
          </div>
          <div className="flex items-center gap-2">
            <StatusDot status={listing.availabilityStatus} showLabel={false} />
            <span className="text-[11px] text-[#475569] truncate">{listing.vendorName}</span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[13px] font-semibold text-[#0B1220] num price">
            {formatPrice(listing.priceMinorMin, listing.priceMinorMax, listing.currency)}
          </p>
          <p className="text-[10px] text-[#94A3B8] num">{formatEta(listing.estimatedShipTimeHours, null)}</p>
        </div>

        <ChevronDown
          size={14}
          className={cn('text-[#94A3B8] shrink-0 transition-transform', expanded && 'rotate-180')}
        />
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-[#E5E7EB]/50 bg-[#FAFBFC]">
          <div className="pt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <MobileSpecRow label="Part #"><PartNumber value={listing.partNumber} /></MobileSpecRow>
            <MobileSpecRow label="Condition"><ConditionBadge condition={listing.condition} /></MobileSpecRow>
            <MobileSpecRow label="Availability"><StatusDot status={listing.availabilityStatus} showLabel /></MobileSpecRow>
            <MobileSpecRow label="ETA">
              <span className="text-[12px] text-[#475569] num">{formatEta(listing.estimatedShipTimeHours, listing.estimatedDeliveryDate)}</span>
            </MobileSpecRow>
            <MobileSpecRow label="Reliability">
              <span className="text-[12px]">{reliabilityLabel(listing.vendorReliabilityScore)}</span>
            </MobileSpecRow>
            <MobileSpecRow label="Vendor type">
              <span className="text-[12px] text-[#475569]">{listing.vendorType}</span>
            </MobileSpecRow>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => router.push(`/listings/${listing.id}`)}
              className="flex-1 py-2 text-[12px] text-white bg-[#1F6FEB] rounded-md font-medium hover:bg-[#134AB5]"
            >
              View detail
            </button>
            {listing.sourceUrl && (
              <a
                href={listing.sourceUrl}
                target="_blank"
                rel="noopener nofollow"
                className="flex items-center justify-center gap-1 px-3 py-2 text-[12px] text-[#D97706] border border-[#D97706] rounded-md"
              >
                <ExternalLink size={11} />
                Vendor
              </a>
            )}
            <CopyAsQuoteLineButton listing={listing} variant="icon" />
          </div>
        </div>
      )}
    </div>
  );
}

function MobileSpecRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-[#94A3B8] uppercase tracking-wide font-semibold mb-0.5">{label}</p>
      <div>{children}</div>
    </div>
  );
}
