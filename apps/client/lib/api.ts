import type {
  ListingsPage,
  VendorDTO,
  ListingImage,
  FitmentResult,
  PartNumberSearchParams,
  FitmentSearchParams,
} from './types';

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:5050';

type ApiFetchOptions = { cache?: RequestCache };

// ── Generic fetch helper ─────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  params?: Record<string, string | undefined>,
  options?: ApiFetchOptions,
): Promise<T> {
  const url = new URL(path, BASE);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') url.searchParams.set(k, v);
    });
  }
  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    cache: options?.cache,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

function metadataFetch<T>(path: string): Promise<T> {
  return apiFetch<T>(path, undefined, { cache: 'force-cache' });
}

// ── Listings ─────────────────────────────────────────────────────────────────

export async function fetchListingsByPartNumber(
  params: PartNumberSearchParams & { cursor?: string; page?: number },
): Promise<ListingsPage> {
  const { partNumber, cursor, page, ...filters } = params;
  return apiFetch<ListingsPage>(`/listings/by-part-number/${encodeURIComponent(partNumber)}`, {
    cursor,
    page: page != null ? String(page) : undefined,
    ...filters,
  });
}

export async function fetchListingsByFitment(
  params: FitmentSearchParams & { cursor?: string; page?: number },
): Promise<ListingsPage> {
  const { cursor, page, ...filters } = params;
  return apiFetch<ListingsPage>('/listings/by-fitment', {
    cursor,
    page: page != null ? String(page) : undefined,
    ...filters,
  });
}

export async function fetchListingImages(listingId: string): Promise<{ listingImages: ListingImage[] }> {
  return apiFetch(`/listings/images/${encodeURIComponent(listingId)}`);
}

// ── Fitments ─────────────────────────────────────────────────────────────────

export async function fetchPartFitments(partId: string): Promise<{ fitments: FitmentResult[] }> {
  return apiFetch(`/fitment/${encodeURIComponent(partId)}`);
}

export async function fetchMakesWithModels(): Promise<Record<string, string[]>> {
  return metadataFetch('/fitment/makes-with-models');
}

export async function fetchYears(): Promise<{ years: { year: number }[] }> {
  return metadataFetch('/fitment/years');
}

export async function fetchCategories(): Promise<{ categories: string[] }> {
  return metadataFetch('/fitment/categories');
}

export async function fetchPositions(): Promise<{ positions: string[] }> {
  return metadataFetch('/fitment/positions');
}

export async function fetchConstraints(): Promise<{ constraints: string[] }> {
  return metadataFetch('/fitment/constraints');
}

// ── Vendors ──────────────────────────────────────────────────────────────────

export async function fetchVendors(): Promise<{ vendors: VendorDTO[] }> {
  return metadataFetch('/vendors');
}
