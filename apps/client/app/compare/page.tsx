'use client';

import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import Link from 'next/link';
import { X, Printer, ExternalLink } from 'lucide-react';
import type { ListingDTO } from '@/lib/types';
import { formatPrice, formatEta, conditionLabel, reliabilityLabel, availabilityLabel, identifierTypeLabel, vendorTypeLabel } from '@/lib/formatters';
import PartNumber from '@/components/shared/PartNumber';
import StatusDot from '@/components/shared/StatusDot';
import BestValueBadge from '@/components/results/BestValueBadge';
import CopyAsQuoteLineButton from '@/components/results/CopyAsQuoteLineButton';
import Container from '@/components/layout/Container';
import { useCompareStore } from '@/store/compareStore';
import { computeBestValueScores, getRankedIds } from '@/lib/bestValue';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';

// Row definitions for the compare table
const ROWS: { key: string; label: string; render: (l: ListingDTO) => React.ReactNode }[] = [
  { key: 'image', label: '', render: () => null },
  { key: 'part', label: 'Part name', render: l => <span className="font-medium text-[#0B1220]">{l.partName}</span> },
  { key: 'partNumber', label: 'Part #', render: l => <PartNumber value={l.partNumber} /> },
  { key: 'type', label: 'Type', render: l => identifierTypeLabel(l.type) },
  { key: 'condition', label: 'Condition', render: l => conditionLabel(l.condition) },
  {
    key: 'vendor', label: 'Vendor',
    render: l => (
      <div>
        <p className="font-medium">{l.vendorName}</p>
        <p className="text-[11px] text-[#94A3B8]">{vendorTypeLabel(l.vendorType)}</p>
      </div>
    ),
  },
  {
    key: 'reliability', label: 'Reliability',
    render: l => {
      const rel = reliabilityLabel(l.vendorReliabilityScore);
      return (
        <span className={cn('font-medium num', {
          'text-green-600': rel === 'Excellent',
          'text-blue-600': rel === 'Good',
          'text-amber-600': rel === 'Fair',
          'text-red-600': rel === 'Poor',
          'text-gray-400': rel === 'Unrated',
        })}>
          {rel}
        </span>
      );
    },
  },
  { key: 'availability', label: 'Availability', render: l => <StatusDot status={l.availabilityStatus} showLabel /> },
  {
    key: 'eta', label: 'ETA',
    render: l => (
      <span className="num text-[#475569]">
        {formatEta(l.estimatedShipTimeHours, l.estimatedDeliveryDate)}
      </span>
    ),
  },
  {
    key: 'price', label: 'Price',
    render: l => (
      <span className="num price text-[15px] font-bold text-[#0B1220]">
        {formatPrice(l.priceMinorMin, l.priceMinorMax, l.currency)}
      </span>
    ),
  },
  { key: 'confidence', label: 'Fitment confidence', render: l => {
    const score = l.confidenceScore ? parseFloat(String(l.confidenceScore)) : null;
    return score !== null ? `${Math.round(score * 100)}%` : '—';
  }},
  { key: 'weight', label: 'Weight', render: l => l.partWeightGrams ? `${(l.partWeightGrams / 1000).toFixed(2)} kg` : '—' },
  { key: 'sourceVin', label: 'Source VIN', render: l => l.sourceVehicleVin ? <span className="mono text-[11px]">{l.sourceVehicleVin}</span> : '—' },
  { key: 'mileage', label: 'Mileage', render: l => l.sourceMileage ? <span className="num">{l.sourceMileage.toLocaleString()} mi</span> : '—' },
  {
    key: 'actions', label: 'Actions',
    render: l => (
      <div className="flex flex-col gap-2">
        {l.sourceUrl && (
          <a
            href={l.sourceUrl}
            target="_blank"
            rel="noopener nofollow"
            className="inline-flex items-center gap-1 text-[12px] text-[#D97706] hover:underline"
          >
            <ExternalLink size={11} /> View on vendor
          </a>
        )}
        <CopyAsQuoteLineButton listing={l} variant="full" className="text-[12px] py-1" />
      </div>
    ),
  },
];

// Rows where we want to highlight the "best" value
const RANK_KEYS: Record<string, 'lowest-price' | 'fastest-eta' | 'highest-reliability'> = {
  price: 'lowest-price',
  eta: 'fastest-eta',
  reliability: 'highest-reliability',
};

export default function ComparePage() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { selected: storeSelected, remove } = useCompareStore();

  // Resolve listings from URL ids, falling back to compare store
  const idList = (params.get('ids') ?? '').split(',').filter(Boolean);

  const listings = useMemo<ListingDTO[]>(() => {
    if (storeSelected.length > 0 && storeSelected.some(l => idList.includes(l.id))) {
      return storeSelected.filter(l => idList.includes(l.id));
    }
    // Try to find in all query caches
    const results: ListingDTO[] = [];
    const allQueries = queryClient.getQueriesData<{ pages: { listings: ListingDTO[] }[] }>({ queryKey: ['listings'] });
    for (const id of idList) {
      for (const [, data] of allQueries) {
        const found = data?.pages?.flatMap(p => p.listings).find(l => l.id === id);
        if (found) { results.push(found); break; }
      }
    }
    return results;
  }, [idList, storeSelected, queryClient]);

  const removeId = (id: string) => {
    remove(id);
    const remaining = idList.filter(i => i !== id).join(',');
    if (!remaining) router.push('/search');
    else router.push(`/compare?ids=${remaining}`);
  };

  const scores = computeBestValueScores(listings);
  const rankedIds = getRankedIds(scores, 3);
  const rankMap = new Map(rankedIds.map((id, i) => [id, (i + 1) as 1 | 2 | 3]));

  // Per-row best-in-row maps
  const lowestPriceId = listings.reduce((best, l) =>
    !best || l.priceMinorMin < best.priceMinorMin ? l : best, null as ListingDTO | null)?.id;
  const fastestEtaId = listings.filter(l => l.estimatedShipTimeHours !== null)
    .reduce((best, l) => !best || (l.estimatedShipTimeHours! < best.estimatedShipTimeHours!) ? l : best, null as ListingDTO | null)?.id;
  const highestRelId = listings.filter(l => l.vendorReliabilityScore !== null)
    .reduce((best, l) => !best || parseFloat(String(l.vendorReliabilityScore)) > parseFloat(String(best.vendorReliabilityScore)) ? l : best, null as ListingDTO | null)?.id;

  if (listings.length === 0) {
    return (
      <Container className="py-16 text-center">
        <p className="text-[14px] text-[#475569] mb-4">No listings selected for comparison.</p>
        <Link href="/search" className="text-[#1F6FEB] hover:underline">← Back to search</Link>
      </Container>
    );
  }

  return (
    <div className="bg-[#F7F8FA] min-h-screen">
      <div className="bg-white border-b border-[#E5E7EB] py-3 no-print">
        <Container className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/search" className="text-[12px] text-[#475569] hover:text-[#1F6FEB]">← Back to search</Link>
            <span className="text-[14px] font-semibold text-[#0B1220]">Compare parts ({listings.length})</span>
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-[12px] text-[#475569] hover:text-[#0B1220] border border-[#E5E7EB] rounded-md px-3 py-1.5"
          >
            <Printer size={13} />
            Print comparison
          </button>
        </Container>
      </div>

      <Container wide className="py-6 overflow-x-auto">
        {/* Print header */}
        <div className="hidden print:block mb-4">
          <h1 className="text-[18px] font-bold">Part Comparison — Boneyard</h1>
          <p className="text-[12px] text-gray-500">{new Date().toLocaleDateString()}</p>
        </div>

        <div
          className="compare-grid"
          style={{ display: 'grid', gridTemplateColumns: `200px repeat(${listings.length}, minmax(220px, 1fr))` }}
        >
          {/* Header row: remove buttons + best value badge */}
          {/* Row label (empty) */}
          <div className="p-3 bg-[#F7F8FA] border-b border-r border-[#E5E7EB] font-semibold text-[11px] uppercase tracking-wide text-[#94A3B8]" />

          {listings.map(l => (
            <div key={l.id} className="p-3 bg-[#F7F8FA] border-b border-r border-[#E5E7EB] flex items-center justify-between gap-2">
              {rankMap.get(l.id) && <BestValueBadge rank={rankMap.get(l.id)!} />}
              <button
                onClick={() => removeId(l.id)}
                className="ml-auto text-[#94A3B8] hover:text-[#B91C1C] no-print"
                title="Remove from comparison"
              >
                <X size={14} />
              </button>
            </div>
          ))}

          {/* Data rows */}
          {ROWS.map(row => {
            const isRowBold = ['price', 'eta', 'reliability'].includes(row.key);
            return (
              <>
                {/* Label */}
                <div
                  key={`${row.key}-label`}
                  className="p-3 border-b border-r border-[#E5E7EB] text-[12px] font-semibold text-[#475569] bg-[#FAFBFC] flex items-center"
                >
                  {row.label}
                </div>

                {/* Values */}
                {listings.map(l => {
                  const rankKey = RANK_KEYS[row.key];
                  const isBest = (
                    (rankKey === 'lowest-price' && l.id === lowestPriceId) ||
                    (rankKey === 'fastest-eta' && l.id === fastestEtaId) ||
                    (rankKey === 'highest-reliability' && l.id === highestRelId)
                  );
                  return (
                    <div
                      key={`${row.key}-${l.id}`}
                      className={cn(
                        'p-3 border-b border-r border-[#E5E7EB] text-[13px]',
                        isBest && 'bg-amber-50/70',
                        isRowBold && 'font-medium',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span>{row.render(l)}</span>
                        {isBest && row.key === 'price' && <span className="text-[10px] text-amber-600 font-semibold shrink-0">Lowest ↓</span>}
                        {isBest && row.key === 'eta' && <span className="text-[10px] text-blue-600 font-semibold shrink-0">Fastest ↑</span>}
                        {isBest && row.key === 'reliability' && <span className="text-[10px] text-green-600 font-semibold shrink-0">Best ↑</span>}
                      </div>
                    </div>
                  );
                })}
              </>
            );
          })}
        </div>
      </Container>
    </div>
  );
}
