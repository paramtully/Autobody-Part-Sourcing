'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw, Copy } from 'lucide-react';
import Container from '@/components/layout/Container';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  const diagnosticText = [
    `Error: ${error.message}`,
    error.digest ? `Digest: ${error.digest}` : null,
    `URL: ${typeof window !== 'undefined' ? window.location.href : 'unknown'}`,
    `Time: ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n');

  const copyDiagnostics = () => {
    navigator.clipboard.writeText(diagnosticText).catch(() => {});
  };

  return (
    <Container className="py-24 text-center">
      <AlertCircle size={32} className="text-[#B91C1C] mx-auto mb-4" strokeWidth={1.5} />
      <h1 className="text-[17px] font-semibold text-[#0B1220] mb-2">Something went wrong</h1>
      <p className="text-[13px] text-[#475569] mb-6 max-w-sm mx-auto">
        {error.message ?? 'An unexpected error occurred. Please try again or return to search.'}
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1F6FEB] text-white text-[13px] font-medium rounded-md hover:bg-[#134AB5] transition-colors"
        >
          <RefreshCw size={13} />
          Try again
        </button>
        <Link href="/search" className="text-[13px] text-[#1F6FEB] hover:underline">
          Back to search
        </Link>
        <button
          onClick={copyDiagnostics}
          className="inline-flex items-center gap-1.5 px-3 py-2 border border-[#E5E7EB] rounded-md text-[12px] text-[#475569] hover:bg-[#F7F8FA]"
          title="Copy diagnostic info for support"
        >
          <Copy size={11} />
          Copy diagnostics
        </button>
      </div>
    </Container>
  );
}
