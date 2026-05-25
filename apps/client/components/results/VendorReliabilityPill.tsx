import { cn } from '@/lib/cn';
import { reliabilityLabel } from '@/lib/formatters';
import type { VendorType } from '@/lib/types';

interface VendorReliabilityPillProps {
  vendorName: string;
  vendorType: VendorType;
  reliabilityScore: string | number | null;
  className?: string;
}

const VENDOR_TYPE_COLORS: Record<VendorType, string> = {
  OEM: 'bg-blue-50 text-blue-700 border-blue-200',
  AFTERMARKET: 'bg-green-50 text-green-700 border-green-200',
  SALVAGE: 'bg-amber-50 text-amber-700 border-amber-200',
  MARKETPLACE: 'bg-purple-50 text-purple-700 border-purple-200',
};

const RELIABILITY_COLORS: Record<string, string> = {
  Excellent: 'text-green-600',
  Good: 'text-blue-600',
  Fair: 'text-amber-600',
  Poor: 'text-red-600',
  Unrated: 'text-gray-400',
};

export default function VendorReliabilityPill({
  vendorName,
  vendorType,
  reliabilityScore,
  className,
}: VendorReliabilityPillProps) {
  const label = reliabilityLabel(reliabilityScore);
  return (
    <div className={cn('flex items-center gap-1.5 min-w-0', className)}>
      <span className="text-[13px] font-medium text-[#0B1220] truncate">{vendorName}</span>
      <span
        className={cn(
          'inline-flex items-center px-1 py-0 rounded text-[10px] font-semibold border',
          VENDOR_TYPE_COLORS[vendorType],
        )}
      >
        {vendorType}
      </span>
      {reliabilityScore !== null && reliabilityScore !== undefined && (
        <span className={cn('text-[11px] font-medium num', RELIABILITY_COLORS[label] ?? 'text-gray-500')}>
          {label}
        </span>
      )}
    </div>
  );
}
