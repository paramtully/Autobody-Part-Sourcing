'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ListingImage } from '@/lib/types';

interface ListingGalleryProps {
  images: ListingImage[];
  partName: string;
}

export default function ListingGallery({ images, partName }: ListingGalleryProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const prev = useCallback(() => setActiveIdx(i => Math.max(0, i - 1)), []);
  const next = useCallback(() => setActiveIdx(i => Math.min(images.length - 1, i + 1)), [images.length]);

  // Keyboard navigation (arrow keys when lightbox is open)
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxOpen, prev, next]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    if (Math.abs(dx) > 40) dx < 0 ? next() : prev();
    touchStartX.current = null;
  };

  if (!images.length) {
    return (
      <div className="aspect-[4/3] rounded-xl bg-[#F7F8FA] border border-[#E5E7EB] flex items-center justify-center">
        <span className="text-[13px] text-[#94A3B8]">No images available</span>
      </div>
    );
  }

  const active = images[activeIdx]!;
  const hasPrev = activeIdx > 0;
  const hasNext = activeIdx < images.length - 1;

  return (
    <>
      {/* Main image */}
      <div
        className="relative aspect-[4/3] rounded-xl overflow-hidden border border-[#E5E7EB] bg-[#F7F8FA] group"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="absolute inset-0 cursor-zoom-in"
          onClick={() => setLightboxOpen(true)}
        />

        <Image
          src={active.url}
          alt={`${partName} — image ${activeIdx + 1}`}
          fill
          className="object-contain pointer-events-none"
          sizes="(max-width: 768px) 100vw, 50vw"
          priority={activeIdx === 0}
        />

        {/* Prev arrow */}
        {hasPrev && (
          <button
            onClick={e => { e.stopPropagation(); prev(); }}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-white/80 hover:bg-white shadow border border-[#E5E7EB] text-[#0B1220] opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Previous image"
          >
            <ChevronLeft size={16} />
          </button>
        )}

        {/* Next arrow */}
        {hasNext && (
          <button
            onClick={e => { e.stopPropagation(); next(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-white/80 hover:bg-white shadow border border-[#E5E7EB] text-[#0B1220] opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Next image"
          >
            <ChevronRight size={16} />
          </button>
        )}

        {/* Image counter pill */}
        {images.length > 1 && (
          <span className="absolute bottom-2 right-2 z-10 px-2 py-0.5 rounded-full bg-black/40 text-white text-[11px] num select-none">
            {activeIdx + 1} / {images.length}
          </span>
        )}
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.url}
              onClick={() => setActiveIdx(i)}
              className={`relative w-16 h-16 rounded-lg overflow-hidden border-2 shrink-0 transition-colors ${
                i === activeIdx ? 'border-[#1F6FEB]' : 'border-[#E5E7EB] hover:border-[#CBD5E1]'
              }`}
            >
              <Image src={img.url} alt={`Thumbnail ${i + 1}`} fill className="object-contain" sizes="64px" />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            aria-label="Close"
          >
            <X size={24} />
          </button>

          {hasPrev && (
            <button
              onClick={e => { e.stopPropagation(); prev(); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
              aria-label="Previous image"
            >
              <ChevronLeft size={28} />
            </button>
          )}

          <div
            className="relative w-full max-w-3xl aspect-[4/3]"
            onClick={e => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <Image
              src={active.url}
              alt={`${partName} — large view`}
              fill
              className="object-contain"
              sizes="100vw"
            />
          </div>

          {hasNext && (
            <button
              onClick={e => { e.stopPropagation(); next(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
              aria-label="Next image"
            >
              <ChevronRight size={28} />
            </button>
          )}

          <span className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/50 text-[12px] num select-none">
            {activeIdx + 1} / {images.length}
          </span>
        </div>
      )}
    </>
  );
}
