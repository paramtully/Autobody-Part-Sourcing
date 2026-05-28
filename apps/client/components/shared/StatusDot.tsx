import { cn } from '@/lib/cn';
import type { AvailabilityStatus } from '@/lib/types';
import { availabilityLabel } from '@/lib/formatters';

interface StatusDotProps {
  status: AvailabilityStatus;
  showLabel?: boolean;
  className?: string;
}

// Each status gets BOTH color and shape so colorblind users get the same info
const STATUS_CONFIG: Record<AvailabilityStatus, {
  dot: string;
  label: string;
  ariaLabel: string;
}> = {
  IN_STOCK: {
    // Solid filled circle — green
    dot: 'w-2.5 h-2.5 rounded-full bg-green-600',
    label: 'text-green-700',
    ariaLabel: 'In stock',
  },
  LOW_STOCK: {
    // Hollow circle — amber ring
    dot: 'w-2.5 h-2.5 rounded-full border-2 border-amber-500',
    label: 'text-amber-700',
    ariaLabel: 'Low stock',
  },
  BACKORDER: {
    // Striped / X pattern using two diagonal lines via ring + rotate
    dot: 'w-2.5 h-2.5 rounded-full border-2 border-red-600 relative before:absolute before:inset-0 before:rounded-full before:bg-red-600 before:opacity-30',
    label: 'text-red-700',
    ariaLabel: 'Backordered',
  },
  SPECIAL_ORDER: {
    // Dotted ring — info blue
    dot: 'w-2.5 h-2.5 rounded-full border-2 border-dashed border-blue-500',
    label: 'text-blue-700',
    ariaLabel: 'Special order',
  },
  UNKNOWN: {
    dot: 'w-2.5 h-2.5 rounded-full bg-gray-300',
    label: 'text-gray-500',
    ariaLabel: 'Availability unknown',
  },
};

export default function StatusDot({ status, showLabel = true, className }: StatusDotProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.UNKNOWN;
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      aria-label={config.ariaLabel}
    >
      <span className={cn(config.dot)} role="img" aria-hidden="true" />
      {showLabel && (
        <span className={cn('text-[12px] font-medium', config.label)}>
          {availabilityLabel(status)}
        </span>
      )}
    </span>
  );
}
