'use client';

import { cn } from '@/lib/cn';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';

type FitmentConfidence = 'verified' | 'likely' | 'unknown';

function getConfidence(score: string | number | null): FitmentConfidence {
  if (score === null || score === undefined) return 'unknown';
  const n = typeof score === 'string' ? parseFloat(score) : score;
  if (n >= 0.85) return 'verified';
  if (n >= 0.50) return 'likely';
  return 'unknown';
}

interface FitmentBadgeProps {
  confidenceScore: string | number | null;
  partName?: string;
  fitmentSummary?: string; // e.g. "Fits 2018–2022 Honda Civic"
  className?: string;
}

const CONFIGS = {
  verified: {
    label: 'Verified fit',
    icon: ShieldCheck,
    className: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
    popoverNote: 'Fitment data sourced from manufacturer specifications.',
  },
  likely: {
    label: 'Likely fit',
    icon: ShieldAlert,
    className: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
    popoverNote: 'Likely fit — verify with VIN before ordering.',
  },
  unknown: {
    label: 'Check fit',
    icon: ShieldQuestion,
    className: 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100',
    popoverNote: 'Fitment compatibility not confirmed. Verify with VIN or contact vendor.',
  },
};

export default function FitmentBadge({
  confidenceScore,
  partName,
  fitmentSummary,
  className,
}: FitmentBadgeProps) {
  const confidence = getConfidence(confidenceScore);
  const config = CONFIGS[confidence];
  const Icon = config.icon;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border cursor-pointer',
              config.className,
              className,
            )}
            aria-label={`Fitment: ${config.label}`}
          />
        }
      >
        <Icon size={11} />
        {config.label}
      </PopoverTrigger>
      <PopoverContent className="w-64 text-[12px] p-3" side="top">
        <p className="font-medium mb-1">{partName ?? 'Part'} — {config.label}</p>
        {fitmentSummary && <p className="text-[#475569] mb-1">{fitmentSummary}</p>}
        <p className="text-[#475569]">{config.popoverNote}</p>
      </PopoverContent>
    </Popover>
  );
}
