'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  error: Error | null;
  onRetry?: () => void;
}

export default function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <AlertCircle size={32} className="text-[#B91C1C] mb-4" strokeWidth={1.5} />
      <h3 className="text-[15px] font-semibold text-[#0B1220] mb-1">Something went wrong</h3>
      <p className="text-[13px] text-[#475569] max-w-sm mb-4">
        {error?.message ?? 'Unable to load listings. Please try again.'}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#1F6FEB] text-white text-[13px] font-medium hover:bg-[#134AB5] transition-colors"
        >
          <RefreshCw size={13} />
          Try again
        </button>
      )}
    </div>
  );
}
