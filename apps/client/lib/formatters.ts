import type { PartCondition, AvailabilityStatus, VendorType, PartIdentifierType } from './types';

// ── Money ─────────────────────────────────────────────────────────────────────

/** Converts minor-unit integer (cents) to display string: "$12.99" */
export function formatPrice(minorMin: number, minorMax: number | null, currency = 'USD'): string {
  const fmt = (v: number) =>
    (v / 100).toLocaleString('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (minorMax && minorMax !== minorMin) return `${fmt(minorMin)} – ${fmt(minorMax)}`;
  return fmt(minorMin);
}

/** Short price for compact rows: "$12.99" */
export function formatPriceShort(minorMin: number, currency = 'USD'): string {
  return (minorMin / 100).toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── ETA ───────────────────────────────────────────────────────────────────────

export function formatEta(hours: number | null, deliveryDate: string | null): string {
  if (!hours && !deliveryDate) return '—';
  if (hours !== null) {
    const days = Math.ceil(hours / 24);
    if (days <= 1) return 'Ships today';
    if (days <= 2) return 'Ships 1–2 days';
    if (days <= 5) return `Ships ${days} days`;
    return `Ships ~${Math.ceil(days / 7)}w`;
  }
  if (deliveryDate) {
    const d = new Date(deliveryDate);
    return `Est. delivery ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
  }
  return '—';
}

// ── Freshness ─────────────────────────────────────────────────────────────────

export function formatFreshness(isoDate: string | null | undefined): string {
  if (!isoDate) return 'Freshness unknown';
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just refreshed';
  if (mins < 60) return `Refreshed ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Refreshed ${hrs}h ago`;
  return `Refreshed ${Math.floor(hrs / 24)}d ago`;
}

/** Returns the oldest (minimum) lastVerifiedAt from a list of listings */
export function oldestFreshness(dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter(Boolean) as string[];
  if (!valid.length) return null;
  return valid.reduce((oldest, cur) =>
    new Date(cur) < new Date(oldest) ? cur : oldest
  );
}

// ── Condition labels ──────────────────────────────────────────────────────────

const CONDITION_LABELS: Record<PartCondition, string> = {
  NEW_OEM: 'New OEM',
  NEW_AFTERMARKET: 'New A/M',
  RECYCLED: 'Recycled',
  REMANUFACTURED: 'Reman',
  RECONDITIONED: 'Recon',
  UNKNOWN: 'Unknown',
};

export function conditionLabel(c: PartCondition): string {
  return CONDITION_LABELS[c] ?? c;
}

const CONDITION_COLORS: Record<PartCondition, string> = {
  NEW_OEM: 'bg-blue-100 text-blue-800 border-blue-200',
  NEW_AFTERMARKET: 'bg-green-100 text-green-800 border-green-200',
  RECYCLED: 'bg-amber-100 text-amber-800 border-amber-200',
  REMANUFACTURED: 'bg-purple-100 text-purple-800 border-purple-200',
  RECONDITIONED: 'bg-orange-100 text-orange-800 border-orange-200',
  UNKNOWN: 'bg-gray-100 text-gray-600 border-gray-200',
};

export function conditionColorClass(c: PartCondition): string {
  return CONDITION_COLORS[c] ?? CONDITION_COLORS.UNKNOWN;
}

// ── Availability labels ───────────────────────────────────────────────────────

const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Low stock',
  BACKORDER: 'Backorder',
  SPECIAL_ORDER: 'Special order',
  UNKNOWN: 'Unknown',
};

export function availabilityLabel(s: AvailabilityStatus): string {
  return AVAILABILITY_LABELS[s] ?? s;
}

// ── Vendor type labels ────────────────────────────────────────────────────────

const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  OEM: 'OEM',
  AFTERMARKET: 'Aftermarket',
  SALVAGE: 'Salvage',
  MARKETPLACE: 'Marketplace',
};

export function vendorTypeLabel(t: VendorType): string {
  return VENDOR_TYPE_LABELS[t] ?? t;
}

// ── Part identifier type labels ───────────────────────────────────────────────

const IDENTIFIER_TYPE_LABELS: Record<PartIdentifierType, string> = {
  OEM: 'OEM',
  AFTERMARKET: 'Aftermarket',
  INTERCHANGE: 'Interchange',
};

export function identifierTypeLabel(t: PartIdentifierType): string {
  return IDENTIFIER_TYPE_LABELS[t] ?? t;
}

// ── Reliability ───────────────────────────────────────────────────────────────

export function reliabilityLabel(score: string | number | null): string {
  if (score === null || score === undefined) return 'Unrated';
  const n = typeof score === 'string' ? parseFloat(score) : score;
  if (n >= 0.85) return 'Excellent';
  if (n >= 0.70) return 'Good';
  if (n >= 0.50) return 'Fair';
  return 'Poor';
}

export function reliabilityStars(score: string | number | null): number {
  if (score === null || score === undefined) return 0;
  const n = typeof score === 'string' ? parseFloat(score) : score;
  return Math.round(n * 5);
}

// ── Quote line ────────────────────────────────────────────────────────────────
// Canonical "copy as quote line" string for pasting into estimate emails

export function formatQuoteLine(params: {
  partNumber: string;
  partName: string;
  type: PartIdentifierType;
  priceMinorMin: number;
  currency: string;
  estimatedShipTimeHours: number | null;
  vendorName: string;
}): string {
  const { partNumber, partName, type, priceMinorMin, currency, estimatedShipTimeHours, vendorName } = params;
  const price = formatPriceShort(priceMinorMin, currency);
  const typeStr = identifierTypeLabel(type);
  const etaStr = estimatedShipTimeHours != null
    ? formatEta(estimatedShipTimeHours, null)
    : null;
  const parts = [`Part #${partNumber} — ${typeStr} ${partName}, ${price}`];
  if (etaStr) parts.push(`${etaStr} from ${vendorName}`);
  else parts.push(`from ${vendorName}`);
  return parts.join(' — ');
}
