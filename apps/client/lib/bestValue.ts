import type { ListingDTO } from './types';

/**
 * Composite best-value score (0–1, higher = better value).
 * Weights: price 50%, reliability 30%, ETA 20%.
 * All computed client-side from the visible page — no backend change needed.
 */
export function computeBestValueScores(listings: ListingDTO[]): Map<string, number> {
  if (!listings.length) return new Map();

  // Extract normalizable values
  const prices = listings.map(l => l.priceMinorMin).filter(v => v > 0);
  const etas = listings.map(l => l.estimatedShipTimeHours ?? Infinity).filter(v => isFinite(v));
  const reliability = listings
    .map(l => (l.vendorReliabilityScore != null ? parseFloat(String(l.vendorReliabilityScore)) : null))
    .filter((v): v is number => v !== null);

  const minPrice = prices.length ? Math.min(...prices) : 1;
  const maxPrice = prices.length ? Math.max(...prices) : 1;
  const minEta = etas.length ? Math.min(...etas) : 0;
  const maxEta = etas.length ? Math.max(...etas) : 1;

  const normalize = (val: number, min: number, max: number, invert: boolean): number => {
    if (max === min) return 0.5;
    const norm = (val - min) / (max - min);
    return invert ? 1 - norm : norm;
  };

  const scores = new Map<string, number>();
  for (const listing of listings) {
    const priceScore = normalize(listing.priceMinorMin, minPrice, maxPrice, true) * 0.5;
    const rel = listing.vendorReliabilityScore != null ? parseFloat(String(listing.vendorReliabilityScore)) : 0.5;
    const relScore = rel * 0.3;
    const etaVal = listing.estimatedShipTimeHours ?? maxEta;
    const etaScore = isFinite(maxEta) ? normalize(etaVal, minEta, maxEta, true) * 0.2 : 0.1;
    scores.set(listing.id, priceScore + relScore + etaScore);
  }
  return scores;
}

/** Returns the listing id with the highest composite score */
export function getBestValueId(scores: Map<string, number>): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const [id, score] of scores) {
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

/** Returns top-N ids ranked by score (index 0 = best) */
export function getRankedIds(scores: Map<string, number>, n = 3): string[] {
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id);
}
