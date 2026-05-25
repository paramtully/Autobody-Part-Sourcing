'use client';

import { useRouter } from 'next/navigation';
import { ExternalLink, Eye } from 'lucide-react';
import type { ListingDTO } from '@/lib/types';
import PartNumber from '@/components/shared/PartNumber';
import StatusDot from '@/components/shared/StatusDot';
import ConditionBadge from './ConditionBadge';
import FitmentBadge from './FitmentBadge';
import VendorReliabilityPill from './VendorReliabilityPill';
import BestValueBadge from './BestValueBadge';
import CopyAsQuoteLineButton from './CopyAsQuoteLineButton';
import { formatPrice, formatEta } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import { useCompareStore } from '@/store/compareStore';

interface ResultRowProps {
  listing: ListingDTO;
  rank?: 1 | 2 | 3;
  isFocused: boolean;
  onFocus: () => void;
}

export default function ResultRow({ listing, rank, isFocused, onFocus }: ResultRowProps) {
  const router = useRouter();
  const { toggle, isSelected } = useCompareStore();
  const selected = isSelected(listing.id);

  const handleRowClick = () => {
    router.push(`/listings/${listing.id}`, {
      // Pass listing in search params as JSON would be too long; use router state pattern
    });
  };

  const handleMouseEnter = () => {
    router.prefetch(`/listings/${listing.id}`);
    onFocus();
  };

  return (
    <tr
      className={cn(
        'group',
        isFocused && 'ring-1 ring-inset ring-[#1F6FEB]',
      )}
      data-selected={selected ? 'true' : undefined}
      onMouseEnter={handleMouseEnter}
      onClick={handleRowClick}
      tabIndex={0}
      onFocus={onFocus}
      data-listing-id={listing.id}
      aria-label={`${listing.partName}, ${listing.partNumber}`}
    >
      {/* Col 1: Checkbox */}
      <td onClick={e => e.stopPropagation()} className="w-10">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => toggle(listing)}
          className="rounded border-[#CBD5E1] text-[#1F6FEB] focus:ring-[#1F6FEB] focus:ring-1"
          aria-label={`Select ${listing.partName} for comparison`}
        />
      </td>

      {/* Col 2: Part name + number (sticky) */}
      <td className="w-[240px]">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[13px] font-medium text-[#0B1220] truncate leading-tight">
            {listing.partName}
          </span>
          <PartNumber value={listing.partNumber} />
        </div>
      </td>

      {/* Col 3: Condition */}
      <td className="w-[100px]">
        <ConditionBadge condition={listing.condition} />
      </td>

      {/* Col 4: Fitment */}
      <td className="w-[100px]">
        <FitmentBadge
          confidenceScore={listing.confidenceScore}
          partName={listing.partName}
        />
      </td>

      {/* Col 5: Vendor */}
      <td className="w-[170px]">
        <VendorReliabilityPill
          vendorName={listing.vendorName}
          vendorType={listing.vendorType}
          reliabilityScore={listing.vendorReliabilityScore}
        />
      </td>

      {/* Col 6: Availability */}
      <td className="w-[90px]">
        <StatusDot status={listing.availabilityStatus} />
      </td>

      {/* Col 7: ETA */}
      <td className="w-[110px] col-eta">
        <span className="text-[12px] text-[#475569] num">
          {formatEta(listing.estimatedShipTimeHours, listing.estimatedDeliveryDate)}
        </span>
      </td>

      {/* Col 8: Price + best value */}
      <td className="w-[120px] col-price">
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[14px] font-semibold text-[#0B1220] num price">
            {formatPrice(listing.priceMinorMin, listing.priceMinorMax, listing.currency)}
          </span>
          {rank && <BestValueBadge rank={rank} />}
        </div>
      </td>

      {/* Col 9: Row actions */}
      <td className="w-[100px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <CopyAsQuoteLineButton listing={listing} variant="icon" />
          <button
            onClick={handleRowClick}
            className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-[#EEF2F7] text-[#475569] hover:text-[#0B1220] transition-colors"
            title="View part detail"
          >
            <Eye size={13} />
          </button>
          {listing.sourceUrl && (
            <a
              href={listing.sourceUrl}
              target="_blank"
              rel="noopener nofollow"
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-[#FEF3C7] text-[#D97706] hover:text-[#B45309] transition-colors"
              title="View on vendor site"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}
