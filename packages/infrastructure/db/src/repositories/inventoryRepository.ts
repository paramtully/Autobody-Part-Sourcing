import { db } from '../db';
import { listings } from '../schema';
import { eq, and, sql } from 'drizzle-orm';
import type { InventoryRepository } from '@interfaces/repositories/inventoryRepository';
import type InventoryRecord from '@domain/inventoryRecord/inventoryRecord';
import type Vendor from '@domain/vendor/vendor';
import type Part from '@domain/part/part';
import { Currency } from '@domain/listing/currency';
import type { PaginationParams, PaginatedResult } from '@interfaces/repositories/pagination';
import { normalizeLimit, createPaginatedResult } from './paginationHelper';

export class InventoryRepositoryImpl implements InventoryRepository {
    async getInventoryRecord(vendor: Vendor, part: Part): Promise<InventoryRecord | null> {
        const vendorId = (vendor as any).id;
        const partId = (part as any).id;

        if (!vendorId || !partId) {
            throw new Error('Vendor and Part must have id fields');
        }

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
            id: `${vendorId}-${partId}`,
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
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }

    async getInventoryRecordsByPart(
        part: Part,
        pagination?: PaginationParams
    ): Promise<InventoryRecord[] | PaginatedResult<InventoryRecord>> {
        const partId = (part as any).id;

        if (!partId) {
            throw new Error('Part must have id field');
        }

        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        const result = await db
            .select({
                vendorId: listings.vendorId,
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
            .where(eq(listings.partId, partId))
            .groupBy(listings.vendorId)
            .limit(limit + 1)
            .offset(offset);

        const hasMore = result.length > limit;
        const pageResults = hasMore ? result.slice(0, limit) : result;

        const items: InventoryRecord[] = pageResults.map((row) => ({
            id: `${row.vendorId}-${partId}`,
            vendorId: row.vendorId,
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
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        if (!pagination) return items;
        return createPaginatedResult(items, pagination, hasMore);
    }
}
