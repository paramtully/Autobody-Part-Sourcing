import type WarehouseLocation from '@domain/warehouseLocation/warehouseLocation';
import type { warehouseLocations } from '../schema';

type WarehouseLocationRow = typeof warehouseLocations.$inferSelect;
type WarehouseLocationInsert = typeof warehouseLocations.$inferInsert;

/**
 * Convert database row to domain WarehouseLocation
 */
export function toDomainWarehouseLocation(row: WarehouseLocationRow): WarehouseLocation {
    return {
        country: row.country,
        stateOrProvince: row.stateOrProvince ?? undefined,
        city: row.city ?? undefined,
        postalCode: row.postalCode ?? undefined,
    };
}

/**
 * Convert domain WarehouseLocation to database insert format
 */
export function toDbWarehouseLocationInsert(
    location: WarehouseLocation
): WarehouseLocationInsert {
    return {
        country: location.country,
        stateOrProvince: location.stateOrProvince ?? null,
        city: location.city ?? null,
        postalCode: location.postalCode ?? null,
    };
}
