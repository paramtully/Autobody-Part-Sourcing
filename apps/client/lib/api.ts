import type {
  ListingsPage,
  VendorDTO,
  ListingImage,
  FitmentResult,
  PartNumberSearchParams,
  FitmentSearchParams,
} from './types';

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:5050';

// ── Generic fetch helper ─────────────────────────────────────────────────────

async function apiFetch<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(path, BASE);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') url.searchParams.set(k, v);
    });
  }
  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

// ── Listings ─────────────────────────────────────────────────────────────────

export async function fetchListingsByPartNumber(
  params: PartNumberSearchParams & { cursor?: string },
): Promise<ListingsPage> {
  const { partNumber, cursor, ...filters } = params;
  return apiFetch<ListingsPage>(`/listings/by-part-number/${encodeURIComponent(partNumber)}`, {
    cursor,
    ...filters,
  });
}

export async function fetchListingsByFitment(
  params: FitmentSearchParams & { cursor?: string },
): Promise<ListingsPage> {
  const { cursor, ...filters } = params;
  return apiFetch<ListingsPage>('/listings/by-fitment', { cursor, ...filters });
}

export async function fetchListingImages(listingId: string): Promise<{ listingImages: ListingImage[] }> {
  return apiFetch(`/listings/images/${encodeURIComponent(listingId)}`);
}

// ── Fitments ─────────────────────────────────────────────────────────────────

export async function fetchPartFitments(partId: string): Promise<{ fitments: FitmentResult[] }> {
  return apiFetch(`/fitment/${encodeURIComponent(partId)}`);
}

export async function fetchMakesWithModels(): Promise<Record<string, string[]>> {
  return apiFetch('/fitment/makes-with-models');
}

export async function fetchYears(): Promise<{ years: { year: number }[] }> {
  return apiFetch('/fitment/years');
}

export async function fetchCategories(): Promise<{ categories: string[] }> {
  return apiFetch('/fitment/categories');
}

export async function fetchPositions(): Promise<{ positions: string[] }> {
  return apiFetch('/fitment/positions');
}

export async function fetchConstraints(): Promise<{ constraints: string[] }> {
  return apiFetch('/fitment/constraints');
}

// ── Vendors ──────────────────────────────────────────────────────────────────

export async function fetchVendors(): Promise<{ vendors: VendorDTO[] }> {
  return apiFetch('/vendors');
}

// ── VIN decode ────────────────────────────────────────────────────────────────

export async function decodeVin(
  vin: string,
): Promise<{ year: number; make: string; model: string; trim: string | null }> {
  return apiFetch(`/fitment/vin/${encodeURIComponent(vin)}`);
}
