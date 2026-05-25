'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Plus } from 'lucide-react';
import { fetchListingImages, fetchListingsByPartNumber } from '@/lib/api';
import type { ListingDTO } from '@/lib/types';
import { formatPrice, formatEta, conditionLabel, identifierTypeLabel, reliabilityLabel } from '@/lib/formatters';
import Container from '@/components/layout/Container';
import ListingGallery from '@/components/listing/ListingGallery';
import VendorPanel from '@/components/listing/VendorPanel';
import ListingFitments from '@/components/listing/ListingFitments';
import PartNumber from '@/components/shared/PartNumber';
import ConditionBadge from '@/components/results/ConditionBadge';
import FitmentBadge from '@/components/results/FitmentBadge';
import CopyAsQuoteLineButton from '@/components/results/CopyAsQuoteLineButton';
import { useCompareStore } from '@/store/compareStore';
import { Skeleton } from '@/components/ui/skeleton';

interface Params {
  id: string;
}

export default function ListingDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { add, isSelected, remove } = useCompareStore();

  // Try to find listing in the existing query cache first
  const [cachedListing, setCachedListing] = useState<ListingDTO | null>(() => {
    const allQueries = queryClient.getQueriesData<{ pages: { listings: ListingDTO[] }[] }>({ queryKey: ['listings'] });
    for (const [, data] of allQueries) {
      const found = data?.pages?.flatMap(p => p.listings).find(l => l.id === id);
      if (found) return found;
    }
    return null;
  });

  const listing = cachedListing;
  const selected = listing ? isSelected(listing.id) : false;

  const { data: imagesData, isLoading: imagesLoading } = useQuery({
    queryKey: ['listing-images', id],
    queryFn: () => fetchListingImages(id),
    enabled: !!listing,
  });

  if (!listing) {
    return (
      <Container className="py-10">
        <div className="text-center py-20">
          <p className="text-[14px] text-[#475569] mb-4">Listing not found. Return to search to find parts.</p>
          <Link href="/search" className="text-[#1F6FEB] hover:underline text-[13px]">← Back to search</Link>
        </div>
      </Container>
    );
  }

  const images = imagesData?.listingImages ?? [];

  return (
    <div className="bg-[#F7F8FA] min-h-screen">
      {/* Breadcrumb */}
      <div className="bg-white border-b border-[#E5E7EB] no-print">
        <Container className="py-2.5 flex items-center gap-2 text-[12px] text-[#475569]">
          <button onClick={() => router.back()} className="flex items-center gap-1 hover:text-[#1F6FEB] transition-colors">
            <ArrowLeft size={13} />
            Back to results
          </button>
          <span className="text-[#CBD5E1]">/</span>
          <span className="text-[#0B1220] font-medium truncate">{listing.partName}</span>
        </Container>
      </div>

      <Container className="py-8">
        <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
          {/* Left column: gallery + specs */}
          <div className="space-y-8">
            {/* Gallery */}
            {imagesLoading ? (
              <Skeleton className="aspect-[4/3] rounded-xl" />
            ) : (
              <ListingGallery images={images} partName={listing.partName} />
            )}

            {/* Specs */}
            <div>
              <h3 className="text-[14px] font-semibold text-[#0B1220] mb-3">Specifications</h3>
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
                <SpecRow label="Part number"><PartNumber value={listing.partNumber} /></SpecRow>
                <SpecRow label="Type">{identifierTypeLabel(listing.type)}</SpecRow>
                <SpecRow label="Manufacturer">{listing.manufacturer ?? '—'}</SpecRow>
                <SpecRow label="Certification">{listing.certification ?? '—'}</SpecRow>
                <SpecRow label="Category">{listing.partCategory.replace(/_/g, ' ')}</SpecRow>
                {listing.partPosition && <SpecRow label="Position">{listing.partPosition.replace(/_/g, ' ')}</SpecRow>}
                {listing.partWeightGrams && <SpecRow label="Weight">{(listing.partWeightGrams / 1000).toFixed(2)} kg</SpecRow>}
                {listing.sourceVehicleVin && <SpecRow label="Source VIN"><span className="mono">{listing.sourceVehicleVin}</span></SpecRow>}
                {listing.sourceMileage && <SpecRow label="Mileage"><span className="num">{listing.sourceMileage.toLocaleString()} mi</span></SpecRow>}
                <SpecRow label="Condition">{conditionLabel(listing.condition)}</SpecRow>
                {listing.quantityAvailable !== null && (
                  <SpecRow label="Qty available"><span className="num">{listing.quantityAvailable}</span></SpecRow>
                )}
                {listing.partIsDiscontinued && (
                  <SpecRow label="Status"><span className="text-red-600 font-medium">Discontinued</span></SpecRow>
                )}
              </div>

              {listing.description && (
                <div className="mt-4">
                  <p className="text-[12px] text-[#94A3B8] uppercase tracking-wide font-semibold mb-1">Description</p>
                  <p className="text-[13px] text-[#475569] leading-relaxed">{listing.description}</p>
                </div>
              )}
            </div>

            {/* Fitments */}
            <ListingFitments partId={listing.partId} />
          </div>

          {/* Right column: part header + vendor panel + CTAs */}
          <div className="space-y-5 lg:sticky lg:top-16">
            {/* Header */}
            <div>
              <h1 className="text-[20px] font-bold text-[#0B1220] leading-tight mb-2">{listing.partName}</h1>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <PartNumber value={listing.partNumber} className="text-[13px]" />
                <ConditionBadge condition={listing.condition} />
                <FitmentBadge
                  confidenceScore={listing.confidenceScore}
                  partName={listing.partName}
                />
              </div>
              {listing.confidenceScore && parseFloat(String(listing.confidenceScore)) < 0.85 && (
                <p className="text-[12px] text-[#B45309] bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
                  Likely fit — verify with VIN before ordering.
                </p>
              )}
            </div>

            {/* Vendor panel */}
            <VendorPanel
              vendorName={listing.vendorName}
              vendorType={listing.vendorType}
              reliabilityScore={listing.vendorReliabilityScore}
              orderContactEmail={listing.vendorOrderContactEmail}
              availabilityStatus={listing.availabilityStatus}
              lastVerifiedAt={listing.lastVerifiedAt}
            />

            {/* Price block */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-[0_1px_2px_rgba(2,6,23,0.05)]">
              <p className="text-[12px] text-[#94A3B8] mb-1">Price</p>
              <p className="text-[26px] font-bold text-[#0B1220] num price">
                {formatPrice(listing.priceMinorMin, listing.priceMinorMax, listing.currency)}
              </p>
              <p className="text-[12px] text-[#475569] mt-1">
                {formatEta(listing.estimatedShipTimeHours, listing.estimatedDeliveryDate)}
              </p>
            </div>

            {/* CTAs */}
            <div className="flex flex-col gap-2.5">
              {listing.sourceUrl ? (
                <a
                  href={listing.sourceUrl}
                  target="_blank"
                  rel="noopener nofollow"
                  className="flex items-center justify-center gap-2 py-3 bg-[#D97706] text-white text-[14px] font-semibold rounded-md hover:bg-[#B45309] transition-colors"
                >
                  <ExternalLink size={15} />
                  View on vendor site
                </a>
              ) : (
                <button disabled className="flex items-center justify-center gap-2 py-3 bg-[#E5E7EB] text-[#94A3B8] text-[14px] rounded-md cursor-not-allowed">
                  No vendor link available
                </button>
              )}

              <CopyAsQuoteLineButton listing={listing} variant="full" />

              <button
                onClick={() => selected ? remove(listing.id) : add(listing)}
                className="flex items-center justify-center gap-1.5 py-2 text-[13px] text-[#1F6FEB] border border-[#1F6FEB] rounded-md hover:bg-blue-50 transition-colors"
              >
                <Plus size={14} />
                {selected ? 'Remove from compare' : 'Add to compare'}
              </button>
            </div>
          </div>
        </div>
      </Container>
    </div>
  );
}

function SpecRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-[#F7F8FA] last:border-0">
      <span className="text-[12px] text-[#94A3B8] w-28 shrink-0">{label}</span>
      <span className="text-[12px] text-[#0B1220]">{children}</span>
    </div>
  );
}
