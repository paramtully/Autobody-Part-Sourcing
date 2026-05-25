'use client';

import { useState, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

interface PartNumberProps {
  value: string;
  className?: string;
  showIcon?: boolean;
}

export default function PartNumber({ value, className, showIcon = true }: PartNumberProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      navigator.clipboard.writeText(value).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      });
    },
    [value],
  );

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'inline-flex items-center gap-1 mono num text-[12px] cursor-copy group',
        copied ? 'text-green-600' : 'text-[#475569] hover:text-[#0B1220]',
        className,
      )}
      aria-label={`Part number ${value} — click to copy`}
    >
      <span className="tracking-wide">{value}</span>
      {showIcon && (
        <span className="opacity-0 group-hover:opacity-60 transition-opacity">
          {copied ? (
            <Check size={11} className="text-green-600 opacity-100!" />
          ) : (
            <Copy size={11} />
          )}
        </span>
      )}
    </button>
  );
}
