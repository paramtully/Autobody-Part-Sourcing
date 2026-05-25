import { cn } from '@/lib/cn';
import { Star } from 'lucide-react';

type Rank = 1 | 2 | 3;

interface BestValueBadgeProps {
  rank: Rank;
  className?: string;
}

const RANK_CONFIG: Record<Rank, { label: string; colors: string }> = {
  1: { label: 'Best value', colors: 'bg-amber-50 text-amber-700 border-amber-300' },
  2: { label: '2nd best', colors: 'bg-gray-50 text-gray-600 border-gray-200' },
  3: { label: '3rd best', colors: 'bg-gray-50 text-gray-500 border-gray-200' },
};

export default function BestValueBadge({ rank, className }: BestValueBadgeProps) {
  const { label, colors } = RANK_CONFIG[rank];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border',
        colors,
        className,
      )}
      aria-label={`Rank: ${label}`}
    >
      {rank === 1 && <Star size={9} fill="currentColor" />}
      {label}
    </span>
  );
}
