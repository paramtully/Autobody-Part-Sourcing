import { db } from '../db';
import { warehouseLocations, vendorWarehouseLocations } from '../schema';
import { eq, and } from 'drizzle-orm';
import type { WarehouseLocationRepository } from '@interfaces/repositories/warehouseLocationRepository';
import { WarehouseLocation } from '@domain/warehouseLocation';
import { toDomainWarehouseLocation, toDbWarehouseLocationInsert } from '../mappers';

export class WarehouseLocationRepositoryImpl implements WarehouseLocationRepository {
    async findById(id: string): Promise<WarehouseLocation | null> {
        const rows = await db
            .select()
            .from(warehouseLocations)
            .where(eq(warehouseLocations.id, id))
            .limit(1);

        if (rows.length === 0) {
            return null;
        }

        return toDomainWarehouseLocation(rows[0]);
    }

    async findByLocation(location: WarehouseLocation): Promise<WarehouseLocation | null> {
        const rows = await db
            .select()
            .from(warehouseLocations)
            .where(
                and(
                    eq(warehouseLocations.country, location.country),
                    eq(warehouseLocations.stateOrProvince, location.stateOrProvince ?? null),
                    eq(warehouseLocations.city, location.city ?? null),
                    eq(warehouseLocations.postalCode, location.postalCode ?? null)
                )
            )
            .limit(1);

        if (rows.length === 0) {
            return null;
        }

        return toDomainWarehouseLocation(rows[0]);
    }

    async upsert(location: WarehouseLocation & { id?: string }): Promise<WarehouseLocation> {
        // Check if location with same details exists
        const existing = await this.findByLocation(location);
        if (existing) {
            return existing;
        }

        // Insert new location
        const [inserted] = await db
            .insert(warehouseLocations)
            .values(toDbWarehouseLocationInsert(location))
            .returning();

        return toDomainWarehouseLocation(inserted);
    }

    async linkVendorToLocation(vendorId: string, locationId: string): Promise<void> {
        await db
            .insert(vendorWarehouseLocations)
            .values({
                vendorId,
                warehouseLocationId: locationId,
            })
            .onConflictDoNothing();
    }
}
