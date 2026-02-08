import { db } from '../../infrastructure/db/src/db';
import { listings } from '../../infrastructure/db/src/schema';
import { eq, and, sql } from 'drizzle-orm';
import type InventoryRecord from '@domain/inventoryRecord/inventoryRecord';
import { Currency } from '@domain/listing/currency';

/**
 * Get aggregated inventory record for a vendor and part.
 * Computes statistics from listings table on-demand.
 */
export async function getInventoryRecord(
  vendorId: string,
  partId: string
): Promise<InventoryRecord | null> {
  const result = await db
    .select({
      totalListingsCount: sql<number>`COUNT(*)::int`,
      activeListingsCount: sql<number>`COUNT(*) FILTER (WHERE ${listings.isActive} = true)::int`,
      lowestPriceMinor: sql<number | null>`MIN(${listings.priceMinorMin})`,
      highestPriceMinor: sql<number | null>`MAX(${listings.priceMinorMax})`,
      currency: sql<string | null>`MODE() WITHIN GROUP (ORDER BY ${listings.currency})`,
      totalQuantityAvailable: sql<number | null>`SUM(${listings.quantityAvailable})`,
      hasNewOem: sql<boolean>`BOOL_OR(${listings.condition} = 'NEW_OEM')`,
      hasNewAftermarket: sql<boolean>`BOOL_OR(${listings.condition} = 'NEW_AFTERMARKET')`,
      hasRecycled: sql<boolean>`BOOL_OR(${listings.condition} = 'RECYCLED')`,
      hasRemanufactured: sql<boolean>`BOOL_OR(${listings.condition} = 'REMANUFACTURED')`,
      hasReconditioned: sql<boolean>`BOOL_OR(${listings.condition} = 'RECONDITIONED')`,
      hasUnknown: sql<boolean>`BOOL_OR(${listings.condition} = 'UNKNOWN')`,
      lastUpdatedAt: sql<Date>`MAX(${listings.lastVerifiedAt})`,
    })
    .from(listings)
    .where(and(eq(listings.vendorId, vendorId), eq(listings.partId, partId)));

  if (result.length === 0 || result[0].totalListingsCount === 0) {
    return null;
  }

  const row = result[0];

  return {
    id: `${vendorId}-${partId}`, // Composite ID for compatibility
    vendorId,
    partId,
    totalListingsCount: row.totalListingsCount,
    activeListingsCount: row.activeListingsCount,
    lowestPriceMinor: row.lowestPriceMinor ?? undefined,
    highestPriceMinor: row.highestPriceMinor ?? undefined,
    currency: row.currency as Currency | undefined,
    totalQuantityAvailable: row.totalQuantityAvailable ?? undefined,
    hasNewOem: row.hasNewOem,
    hasNewAftermarket: row.hasNewAftermarket,
    hasRecycled: row.hasRecycled,
    hasRemanufactured: row.hasRemanufactured,
    hasReconditioned: row.hasReconditioned,
    hasUnknown: row.hasUnknown,
    lastUpdatedAt: row.lastUpdatedAt,
    createdAt: new Date(), // Not stored, use current time
    updatedAt: new Date(), // Not stored, use current time
  };
}
