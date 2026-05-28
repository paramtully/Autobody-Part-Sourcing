'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Hash, Car } from 'lucide-react';
import PartNumberInput from '@/components/search/PartNumberInput';
import FitmentWizard from '@/components/search/FitmentWizard';
import { useRecentSearches } from '@/lib/useRecentSearches';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { Clock, Tag } from 'lucide-react';

type SearchMode = 'part' | 'fitment';

export default function SearchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const mode: SearchMode = (params.get('mode') as SearchMode) ?? 'part';
  const { partSearches, fitmentSearches } = useRecentSearches();

  const setMode = (m: SearchMode) => {
    router.push(`/search?mode=${m}`, { scroll: false });
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex flex-col items-center pt-16 pb-24 px-4">
      {/* Logo / header */}
      <div className="mb-8 text-center">
        <h1 className="text-[28px] font-bold text-[#0B1220] tracking-tight">Partsync</h1>
        <p className="text-[14px] text-[#475569] mt-1">Collision parts from every vendor, one search</p>
      </div>

      {/* Search card */}
      <div className="w-full max-w-[700px] bg-white border border-[#E5E7EB] rounded-xl shadow-[0_1px_2px_rgba(2,6,23,0.05)]">
        {/* Tabs */}
        <div className="flex border-b border-[#E5E7EB] rounded-t-xl overflow-hidden">
          <TabButton active={mode === 'part'} onClick={() => setMode('part')} icon={Hash}>
            Part number
          </TabButton>
          <TabButton active={mode === 'fitment'} onClick={() => setMode('fitment')} icon={Car}>
            Vehicle fitment
          </TabButton>
        </div>

        {/* Content */}
        <div className="p-5">
          {mode === 'part' ? (
            <div>
              <p className="text-[12px] text-[#94A3B8] mb-3">
                Enter an OEM part number, aftermarket part number, or interchange number. Dashes are optional.
              </p>
              <PartNumberInput autoFocus />
            </div>
          ) : (
            <div>
              <p className="text-[12px] text-[#94A3B8] mb-3">
                Select the vehicle and part type to find compatible listings across all vendors.
              </p>
              <FitmentWizard />
            </div>
          )}
        </div>
      </div>

      {/* Recent searches */}
      {mode === 'part' && partSearches.length > 0 && (
        <RecentSection title="Recent part searches">
          {partSearches.slice(0, 6).map((s, i) => (
            <Link
              key={i}
              href={`/search/results?q=${encodeURIComponent(s.query)}&mode=part`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-md text-[12px] text-[#0B1220] hover:border-[#1F6FEB] hover:text-[#1F6FEB] transition-colors mono"
            >
              <Clock size={11} className="text-[#94A3B8]" />
              {s.query}
              {s.vinTag && <span className="text-[#94A3B8] flex items-center gap-0.5"><Tag size={9} />{s.vinTag}</span>}
            </Link>
          ))}
        </RecentSection>
      )}

      {mode === 'fitment' && fitmentSearches.length > 0 && (
        <RecentSection title="Recent vehicle searches">
          {fitmentSearches.slice(0, 5).map((s, i) => (
            <Link
              key={i}
              href={`/search/results?mode=fitment&year=${s.year}&make=${s.make}&model=${s.model}${s.category ? `&category=${s.category}` : ''}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-md text-[12px] text-[#0B1220] hover:border-[#1F6FEB] hover:text-[#1F6FEB] transition-colors"
            >
              <Clock size={11} className="text-[#94A3B8]" />
              {s.year} {s.make} {s.model}
              {s.category && <span className="text-[#94A3B8]">· {s.category.replace(/_/g, ' ')}</span>}
              {s.vinTag && <span className="text-[#94A3B8] flex items-center gap-0.5"><Tag size={9} />{s.vinTag}</span>}
            </Link>
          ))}
        </RecentSection>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-2 py-3.5 text-[13px] font-medium transition-colors border-b-2',
        active
          ? 'border-[#1F6FEB] text-[#1F6FEB] bg-blue-50/30'
          : 'border-transparent text-[#475569] hover:text-[#0B1220] hover:bg-[#F7F8FA]',
      )}
    >
      <Icon size={14} />
      {children}
    </button>
  );
}

function RecentSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 w-full max-w-[700px]">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-[#94A3B8] mb-2">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
