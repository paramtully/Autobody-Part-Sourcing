'use client';

import { useState, useCallback } from 'react';
import { ClipboardList, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatQuoteLine } from '@/lib/formatters';
import type { ListingDTO } from '@/lib/types';

interface CopyAsQuoteLineButtonProps {
  listing: ListingDTO;
  variant?: 'icon' | 'full';
  className?: string;
}

export default function CopyAsQuoteLineButton({
  listing,
  variant = 'icon',
  className,
}: CopyAsQuoteLineButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const text = formatQuoteLine({
        partNumber: listing.partNumber,
        partName: listing.partName,
        type: listing.type,
        priceMinorMin: listing.priceMinorMin,
        currency: listing.currency,
        estimatedShipTimeHours: listing.estimatedShipTimeHours,
        vendorName: listing.vendorName,
      });
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      });
    },
    [listing],
  );

  if (variant === 'icon') {
    return (
      <button
        onClick={handleCopy}
        className={cn(
          'inline-flex items-center justify-center w-7 h-7 rounded hover:bg-[#EEF2F7] text-[#475569] hover:text-[#0B1220] transition-colors',
          className,
        )}
        title="Copy as quote line"
        aria-label="Copy as quote line"
      >
        {copied ? <Check size={13} className="text-green-600" /> : <ClipboardList size={13} />}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[13px] font-medium transition-colors',
        copied
          ? 'border-green-200 bg-green-50 text-green-700'
          : 'border-[#E5E7EB] bg-white text-[#475569] hover:bg-[#F7F8FA] hover:text-[#0B1220]',
        className,
      )}
    >
      {copied ? <Check size={13} /> : <ClipboardList size={13} />}
      {copied ? 'Copied!' : 'Copy as quote line'}
    </button>
  );
}
