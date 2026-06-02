'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchListingsByPartNumber, fetchListingsByFitment, fetchVendors } from '@/lib/api';
import { computeBestValueScores, getRankedIds } from '@/lib/bestValue';
import { oldestFreshness } from '@/lib/formatters';
import { useDensity } from '@/lib/useDensity';
import type { ListingDTO, SortOption, PartIdentifierType, AvailabilityFilter, CurrencyFilter } from '@/lib/types';

import ResultsToolbar from '@/components/results/ResultsToolbar';
import FiltersSidebar from '@/components/results/FiltersSidebar';
import MobileFilterDrawer from '@/components/results/MobileFilterDrawer';
import ResultRow from '@/components/results/ResultRow';
import MobileResultRow from '@/components/results/MobileResultRow';
import ResultRowSkeleton from '@/components/results/ResultRowSkeleton';
import EmptyState from '@/components/results/EmptyState';
import ErrorState from '@/components/results/ErrorState';
import CompareTray from '@/components/results/CompareTray';
import Container from '@/components/layout/Container';
import { cn } from '@/lib/cn';
import { vendorsForFilter } from '@/lib/vendors';

const TABLE_COLUMNS = [
  { key: 'select', label: '', width: 'w-10' },
  { key: 'part', label: 'Part', width: 'w-[240px]' },
  { key: 'condition', label: 'Condition', width: 'w-[100px]' },
  { key: 'fitment', label: 'Fitment', width: 'w-[100px]' },
  { key: 'vendor', label: 'Vendor', width: 'w-[170px]' },
  { key: 'availability', label: 'Avail.', width: 'w-[90px]' },
  { key: 'eta', label: 'ETA', width: 'w-[110px]', extraClass: 'col-eta' },
  { key: 'price', label: 'Price', width: 'w-[120px]', extraClass: 'col-price' },
  { key: 'actions', label: '', width: 'w-[100px]' },
];

export default function ResultsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [density, setDensity] = useDensity();
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const loadMoreRef = useRef<HTMLElement>(null);

  const mode = params.get('mode') ?? 'part';
  const partNumber = params.get('q') ?? '';
  const make = params.get('make') ?? '';
  const model = params.get('model') ?? '';
  const year = params.get('year') ?? '';
  const category = params.get('category') ?? '';
  const position = params.get('position') ?? '';
  const constraint = params.get('constraint') ?? '';
  const sort = (params.get('sort') as SortOption) ?? 'best_match';
  const partType = (params.get('partType') as PartIdentifierType | null) ?? undefined;
  const condition = params.get('condition') ?? '';
  const vendorId = params.get('vendorId') ?? '';
  const availability = (params.get('availability') as AvailabilityFilter) ?? 'ANY';

  const currencyParam = params.get('currency') as CurrencyFilter | null;
  const currency: CurrencyFilter = currencyParam ?? 'CAD';

  // On first mount, if the URL has no currency param, read localStorage then
  // default to CAD and write it back so the URL is always the source of truth.
  useEffect(() => {
    if (currencyParam !== null) return;
    const stored = typeof window !== 'undefined'
      ? window.localStorage.getItem('region')
      : null;
    const initial: CurrencyFilter = stored === 'USD' || stored === 'CAD' ? stored : 'CAD';
    const next = new URLSearchParams(params.toString());
    next.set('currency', initial);
    router.replace(`?${next.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFitment = mode === 'fitment';
  const isEnabled = isFitment ? !!(make && model && year) : !!partNumber;

  // Vendors for filter sidebar
  const { data: vendorsData } = useQuery({
    queryKey: ['vendors'],
    queryFn: fetchVendors,
    staleTime: 5 * 60_000,
  });

  const filterVendors = vendorsForFilter(vendorsData?.vendors ?? []);

  // Listings query — note: partType is applied client-side (see below) so it
  // doesn't appear in the queryKey or in the API call. Flipping OEM/AFTERMARKET
  // just re-filters the already-fetched data instantly, no network roundtrip.
  const queryKey = isFitment
    ? ['listings', 'fitment', { make, model, year, category, position, constraint, sort, condition, vendorId, availability, currency }]
    : ['listings', 'part', { partNumber, sort, condition, vendorId, availability, currency }];

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => {
      const { page, cursor } = pageParam ?? { page: 1, cursor: undefined as string | undefined };
      const base = {
        sort,
        condition: condition || undefined,
        vendorId: vendorId || undefined,
        availability,
        currency,
        page,
        cursor,
      };
      if (isFitment) {
        return fetchListingsByFitment({ make, model, year, category: category || undefined, position: position || undefined, constraint: constraint || undefined, ...base });
      }
      return fetchListingsByPartNumber({ partNumber, ...base });
    },
    getNextPageParam: last => {
      if (!last.hasMore) return undefined;
      return { page: (last.page ?? 1) + 1, cursor: last.cursor ?? undefined };
    },
    initialPageParam: { page: 1, cursor: undefined as string | undefined },
    enabled: isEnabled,
  });

  const allListings: ListingDTO[] = data?.pages.flatMap(p => p.listings) ?? [];

  // Client-side partType filter — instant, applied over cached data.
  // The filter matches the body-shop mental model based on the Condition badge:
  //  - "OEM"        → New OEM, plus Recycled/Reman/Recon when the catalog id is OEM
  //  - "Aftermarket"→ New Aftermarket, plus anything sold under an aftermarket catalog id
  // (`l.type` is the partIdentifier type, `l.condition` is the listing's physical state.)
  const visibleListings = (() => {
    if (!partType) return allListings;
    if (partType === 'OEM') {
      return allListings.filter(l =>
        l.condition === 'NEW_OEM' ||
        (l.condition !== 'NEW_AFTERMARKET' && l.type === 'OEM'),
      );
    }
    if (partType === 'AFTERMARKET') {
      return allListings.filter(l =>
        l.condition === 'NEW_AFTERMARKET' || l.type === 'AFTERMARKET',
      );
    }
    return allListings;
  })();
  const filteredEmpty = allListings.length > 0 && visibleListings.length === 0;
  const totalCount = visibleListings.length;

  const scores = computeBestValueScores(visibleListings);
  const rankedIds = getRankedIds(scores, 3);
  const rankMap = new Map(rankedIds.map((id, i) => [id, (i + 1) as 1 | 2 | 3]));

  const freshDate = oldestFreshness(visibleListings.map(l => l.lastVerifiedAt));

  // Infinite scroll sentinel
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage(); },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Search summary for toolbar
  const searchSummary = isFitment
    ? `${year} ${make} ${model}${category ? ` · ${category}` : ''}`
    : `Part #${partNumber}`;

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (visibleListings.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex(i => Math.min(i + 1, visibleListings.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(i => Math.max(i - 1, 0));
      }
    },
    [visibleListings.length],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className={cn('min-h-screen bg-[#F7F8FA]', density === 'compact' && 'density-compact')}>
      {/* Toolbar */}
      <ResultsToolbar
        totalCount={isLoading ? undefined : totalCount}
        oldestFreshnessDate={freshDate}
        onRefresh={() => refetch()}
        density={density}
        onDensityChange={setDensity}
        searchSummary={searchSummary}
      />

      <Container wide className="py-6">
        <div className="flex gap-6 items-start">
          {/* Filters sidebar — desktop/tablet only */}
          <div className="hidden md:block shrink-0 no-print">
            <FiltersSidebar vendors={filterVendors} />
          </div>

          {/* Main results column — always rendered */}
          <div className="flex-1 min-w-0">
            {/* Mobile filter drawer trigger — sits above results, inside results column */}
            <div className="md:hidden flex items-center gap-2 mb-3">
              <MobileFilterDrawer vendors={filterVendors} />
            </div>

            {!isEnabled ? (
              <EmptyState message="Enter a part number or vehicle fitment to search." />
            ) : isError ? (
              <ErrorState error={error as Error} onRetry={() => refetch()} />
            ) : (
              <>
                {/* Desktop/tablet: full table */}
                <div className="hidden md:block overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(2,6,23,0.05)]">
                  <table className="results-table min-w-[900px]" aria-label="Search results">
                    <thead>
                      <tr>
                        {TABLE_COLUMNS.map(col => (
                          <th
                            key={col.key}
                            className={cn(col.width, col.extraClass)}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {isLoading
                        ? Array.from({ length: 12 }).map((_, i) => <ResultRowSkeleton key={i} />)
                        : visibleListings.length === 0
                          ? (
                            <tr>
                              <td colSpan={TABLE_COLUMNS.length} className="p-0">
                                <EmptyState
                                  partNumber={!isFitment && !filteredEmpty ? partNumber : undefined}
                                  message={filteredEmpty ? `No ${partType} listings in the current results.` : undefined}
                                />
                              </td>
                            </tr>
                          )
                          : visibleListings.map((listing, idx) => (
                            <ResultRow
                              key={listing.id}
                              listing={listing}
                              rank={rankMap.get(listing.id)}
                              isFocused={focusedIndex === idx}
                              onFocus={() => setFocusedIndex(idx)}
                            />
                          ))}
                      {hasNextPage && (
                        <tr ref={loadMoreRef as React.Ref<HTMLTableRowElement>}>
                          <td colSpan={TABLE_COLUMNS.length}>
                            {isFetchingNextPage && (
                              <>
                                <ResultRowSkeleton />
                                <ResultRowSkeleton />
                                <ResultRowSkeleton />
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: expandable rows (NOT cards) */}
                <div className="md:hidden rounded-lg border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(2,6,23,0.05)] overflow-hidden">
                  {isLoading
                    ? Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="px-3 py-3 border-b border-[#E5E7EB]">
                        <div className="flex gap-3 items-center">
                          <div className="w-4 h-4 rounded bg-[#E5E7EB] animate-pulse" />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3.5 w-32 rounded bg-[#E5E7EB] animate-pulse" />
                            <div className="h-3 w-20 rounded bg-[#E5E7EB] animate-pulse" />
                          </div>
                          <div className="h-4 w-14 rounded bg-[#E5E7EB] animate-pulse" />
                        </div>
                      </div>
                    ))
                    : visibleListings.length === 0
                      ? <EmptyState
                          partNumber={!isFitment && !filteredEmpty ? partNumber : undefined}
                          message={filteredEmpty ? `No ${partType} listings in the current results.` : undefined}
                        />
                      : visibleListings.map(listing => (
                        <MobileResultRow
                          key={listing.id}
                          listing={listing}
                          rank={rankMap.get(listing.id)}
                        />
                      ))
                  }
                  {/* Mobile load-more sentinel — shares the same observer as desktop */}
                  {hasNextPage && (
                    <div className="p-3 text-center text-[12px] text-[#94A3B8]">
                      {isFetchingNextPage ? 'Loading more…' : ''}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>{/* end main results column */}
        </div>
      </Container>

      {/* Compare tray (fixed bottom) */}
      <CompareTray />
    </div>
  );
}
