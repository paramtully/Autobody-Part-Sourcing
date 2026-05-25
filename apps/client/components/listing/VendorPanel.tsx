import { Mail } from 'lucide-react';
import type { VendorType } from '@/lib/types';
import { vendorTypeLabel, reliabilityLabel } from '@/lib/formatters';
import StatusDot from '@/components/shared/StatusDot';
import FreshnessChip from '@/components/shared/FreshnessChip';
import type { AvailabilityStatus } from '@/lib/types';
import { cn } from '@/lib/cn';

const VENDOR_TYPE_COLORS: Record<VendorType, string> = {
  OEM: 'bg-blue-50 text-blue-700 border-blue-200',
  AFTERMARKET: 'bg-green-50 text-green-700 border-green-200',
  SALVAGE: 'bg-amber-50 text-amber-700 border-amber-200',
  MARKETPLACE: 'bg-purple-50 text-purple-700 border-purple-200',
};

interface VendorPanelProps {
  vendorName: string;
  vendorType: VendorType;
  reliabilityScore: string | number | null;
  orderContactEmail: string | null;
  availabilityStatus: AvailabilityStatus;
  lastVerifiedAt: string;
  onRefresh?: () => void;
}

export default function VendorPanel({
  vendorName,
  vendorType,
  reliabilityScore,
  orderContactEmail,
  availabilityStatus,
  lastVerifiedAt,
  onRefresh,
}: VendorPanelProps) {
  const relLabel = reliabilityLabel(reliabilityScore);

  return (
    <div className="border border-[#E5E7EB] rounded-xl p-4 space-y-3 bg-white shadow-[0_1px_2px_rgba(2,6,23,0.05)]">
      {/* Vendor name + type */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold text-[#0B1220]">{vendorName}</span>
        <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border', VENDOR_TYPE_COLORS[vendorType])}>
          {vendorTypeLabel(vendorType)}
        </span>
      </div>

      {/* Reliability */}
      {reliabilityScore !== null && (
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-[#475569]">Vendor reliability</span>
          <span className={cn(
            'font-semibold num',
            relLabel === 'Excellent' ? 'text-green-600' :
            relLabel === 'Good' ? 'text-blue-600' :
            relLabel === 'Fair' ? 'text-amber-600' : 'text-red-600',
          )}>
            {relLabel}
          </span>
        </div>
      )}

      {/* Availability */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-[#475569]">Availability</span>
        <StatusDot status={availabilityStatus} />
      </div>

      {/* Freshness */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-[#475569]">Data freshness</span>
        <FreshnessChip isoDate={lastVerifiedAt} onRefresh={onRefresh} />
      </div>

      {/* Contact email */}
      {orderContactEmail && (
        <a
          href={`mailto:${orderContactEmail}`}
          className="flex items-center gap-2 text-[13px] text-[#1F6FEB] hover:text-[#134AB5] transition-colors mt-1"
        >
          <Mail size={13} />
          Ask vendor about this part
        </a>
      )}

      {/* Backorder note */}
      {availabilityStatus === 'BACKORDER' && (
        <p className="text-[12px] text-[#B91C1C] bg-red-50 border border-red-200 rounded-md px-3 py-2">
          Backordered — vendor ETA may slip. Call to confirm.
        </p>
      )}
    </div>
  );
}
