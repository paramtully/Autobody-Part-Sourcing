// ── Core domain types ────────────────────────────────────────────────────────

export type PartCondition =
  | 'NEW_OEM'
  | 'NEW_AFTERMARKET'
  | 'RECYCLED'
  | 'REMANUFACTURED'
  | 'RECONDITIONED'
  | 'UNKNOWN';

export type AvailabilityStatus =
  | 'IN_STOCK'
  | 'LOW_STOCK'
  | 'BACKORDER'
  | 'SPECIAL_ORDER'
  | 'UNKNOWN';

export type PartIdentifierType = 'OEM' | 'AFTERMARKET' | 'INTERCHANGE';

export type VendorType = 'OEM' | 'AFTERMARKET' | 'SALVAGE' | 'MARKETPLACE';

export type Certification = 'CAPA' | 'NSF' | null;

export type SortOption =
  | 'best_match'
  | 'price_asc'
  | 'price_desc'
  | 'eta_asc'
  | 'reliability_desc';

export type AvailabilityFilter = 'IN_STOCK' | 'LOW_STOCK' | 'BACKORDER' | 'ANY';

// ── DTOs (matches API response shape) ────────────────────────────────────────

export interface VendorDTO {
  id: string;
  name: string;
  vendorType: VendorType;
  reliabilityScore: string | number | null;
  orderContactEmail: string | null;
}

export interface ListingDTO {
  id: string;
  partId: string;
  partNumber: string;
  partName: string;
  partCategory: string;
  partPosition: string | null;
  partDescription: string | null;
  partWeightGrams: number | null;
  partIsDiscontinued: boolean;
  type: PartIdentifierType;
  manufacturer: string | null;
  certification: Certification;
  condition: PartCondition;
  description: string | null;
  quantityAvailable: number | null;
  availabilityStatus: AvailabilityStatus;
  priceMinorMin: number;
  priceMinorMax: number | null;
  currency: string;
  estimatedDeliveryDate: string | null;
  estimatedShipTimeHours: number | null;
  sourceUrl: string | null;
  sourceVehicleVin: string | null;
  sourceMileage: number | null;
  confidenceScore: string | number | null;
  lastVerifiedAt: string;
  // Vendor (joined)
  vendorId: string;
  vendorName: string;
  vendorType: VendorType;
  vendorReliabilityScore: string | number | null;
  vendorOrderContactEmail: string | null;
}

export interface ListingsPage {
  listings: ListingDTO[];
  hasMore: boolean;
  cursor: string | null;
}

export interface FitmentResult {
  make: string;
  model: string;
  year: number;
  trim: string | null;
  engine: string | null;
  constraint: string | null;
}

export interface ListingImage {
  url: string;
  imageType: string | null;
  sortOrder: number | null;
}

// ── Search params ─────────────────────────────────────────────────────────────

export type CurrencyFilter = 'USD' | 'CAD';

export interface PartNumberSearchParams {
  partNumber: string;
  sort?: SortOption;
  partType?: PartIdentifierType;
  condition?: string;
  vendorId?: string;
  availability?: AvailabilityFilter;
  currency?: CurrencyFilter;
}

export interface FitmentSearchParams {
  make: string;
  model: string;
  year: string;
  category?: string;
  position?: string;
  constraint?: string;
  sort?: SortOption;
  partType?: PartIdentifierType;
  condition?: string;
  vendorId?: string;
  availability?: AvailabilityFilter;
  currency?: CurrencyFilter;
}

// ── Recent searches (localStorage) ──────────────────────────────────────────

export interface RecentPartSearch {
  type: 'part';
  query: string;
  vinTag?: string;
  searchedAt: string;
}

export interface RecentFitmentSearch {
  type: 'fitment';
  make: string;
  model: string;
  year: string;
  category?: string;
  vinTag?: string;
  searchedAt: string;
}

export type RecentSearch = RecentPartSearch | RecentFitmentSearch;
