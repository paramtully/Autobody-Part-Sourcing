import { cn } from '@/lib/cn';
import { conditionLabel, conditionColorClass } from '@/lib/formatters';
import type { PartCondition } from '@/lib/types';

interface ConditionBadgeProps {
  condition: PartCondition;
  className?: string;
}

export default function ConditionBadge({ condition, className }: ConditionBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border',
        conditionColorClass(condition),
        className,
      )}
    >
      {conditionLabel(condition)}
    </span>
  );
}
