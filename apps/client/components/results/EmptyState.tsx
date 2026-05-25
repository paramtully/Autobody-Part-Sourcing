import Link from 'next/link';
import { SearchX } from 'lucide-react';

interface EmptyStateProps {
  partNumber?: string;
  message?: string;
}

export default function EmptyState({ partNumber, message }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <SearchX size={32} className="text-[#CBD5E1] mb-4" strokeWidth={1.5} />
      <h3 className="text-[15px] font-semibold text-[#0B1220] mb-1">
        {message ?? 'No matching listings'}
      </h3>
      <p className="text-[13px] text-[#475569] max-w-sm mb-4">
        {partNumber
          ? `No listings found for part number "${partNumber}". Try searching by vehicle fitment instead.`
          : 'Try removing the vendor or condition filters, or switch to fitment search.'}
      </p>
      <Link
        href="/search?mode=fitment"
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#1F6FEB] text-white text-[13px] font-medium hover:bg-[#134AB5] transition-colors"
      >
        Search by fitment instead
      </Link>
    </div>
  );
}
