import { db } from '../db';
import { vendors, vendorWarehouseLocations, warehouseLocations } from '../schema';
import { eq } from 'drizzle-orm';
import type { VendorRepository } from '@interfaces/repositories/vendorRepository';
import type Vendor from '@domain/vendor/vendor';
import type { PaginationParams, PaginatedResult } from '@interfaces/repositories/pagination';
import { toDomainVendor, toDbVendorInsert, type VendorAggregateData } from '../mappers';
import { normalizeLimit, createPaginatedResult } from './paginationHelper';

export class VendorRepositoryImpl implements VendorRepository {
    async findById(id: string): Promise<Vendor | null> {
        // Get vendor
        const vendorRows = await db
            .select()
            .from(vendors)
            .where(eq(vendors.id, id))
            .limit(1);

        if (vendorRows.length === 0) {
            return null;
        }

        const vendor = vendorRows[0];

        // Get warehouse locations
        const locationRows = await db
            .select({
                warehouseLocation: warehouseLocations,
            })
            .from(vendorWarehouseLocations)
            .innerJoin(
                warehouseLocations,
                eq(vendorWarehouseLocations.warehouseLocationId, warehouseLocations.id)
            )
            .where(eq(vendorWarehouseLocations.vendorId, id));

        const aggregateData: VendorAggregateData = {
            vendor,
            locations: locationRows,
        };

        const domainVendor = toDomainVendor(aggregateData);
        // Add id to domain object (not in interface but needed)
        return { ...domainVendor, id } as Vendor & { id: string };
    }

    async findAll(
        pagination?: PaginationParams
    ): Promise<Vendor[] | PaginatedResult<Vendor>> {
        const limit = normalizeLimit(pagination?.limit);
        const offset = pagination?.offset ?? 0;

        const vendorRows = await db
            .select()
            .from(vendors)
            .limit(limit + 1)
            .offset(offset);

        const hasMore = vendorRows.length > limit;
        const pageVendors = hasMore ? vendorRows.slice(0, limit) : vendorRows;
        const vendorIds = pageVendors.map((v) => v.id);

        // Get all warehouse locations for these vendors
        const locationRows = await db
            .select({
                vendorId: vendorWarehouseLocations.vendorId,
                warehouseLocation: warehouseLocations,
            })
            .from(vendorWarehouseLocations)
            .innerJoin(
                warehouseLocations,
                eq(vendorWarehouseLocations.warehouseLocationId, warehouseLocations.id)
            )
            .where(vendorWarehouseLocations.vendorId.in(vendorIds));

        // Group locations by vendorId
        const locationsByVendor = new Map<string, Array<{ warehouseLocation: typeof warehouseLocations.$inferSelect }>>();
        for (const row of locationRows) {
            const locations = locationsByVendor.get(row.vendorId) || [];
            locations.push({ warehouseLocation: row.warehouseLocation });
            locationsByVendor.set(row.vendorId, locations);
        }

        const items: (Vendor & { id: string })[] = pageVendors.map((vendor) => {
            const aggregateData: VendorAggregateData = {
                vendor,
                locations: locationsByVendor.get(vendor.id) || [],
            };
            const domainVendor = toDomainVendor(aggregateData);
            return { ...domainVendor, id: vendor.id } as Vendor & { id: string };
        });

        if (!pagination) return items;
        return createPaginatedResult(items, pagination, hasMore);
    }

    async upsert(
        vendor: Omit<Vendor, 'createdAt' | 'updatedAt'> & { id?: string }
    ): Promise<Vendor> {
        const [inserted] = await db
            .insert(vendors)
            .values(toDbVendorInsert(vendor))
            .onConflictDoUpdate({
                target: vendors.id,
                set: {
                    name: vendor.name,
                    vendorType: vendor.vendorType,
                    integrationType: vendor.integrationType,
                    apiEndpoint: vendor.apiEndpoint ?? null,
                    averageProcessingTimeHours: vendor.averageProcessingTimeHours ?? null,
                    reliabilityScore: vendor.reliabilityScore ?? null,
                    cancellationRate: vendor.cancellationRate ?? null,
                    requiresManualOrdering: vendor.requiresManualOrdering ?? false,
                    updatedAt: new Date(),
                },
            })
            .returning();

        // Get warehouse locations (empty for new vendor)
        const locationRows = await db
            .select({
                warehouseLocation: warehouseLocations,
            })
            .from(vendorWarehouseLocations)
            .innerJoin(
                warehouseLocations,
                eq(vendorWarehouseLocations.warehouseLocationId, warehouseLocations.id)
            )
            .where(eq(vendorWarehouseLocations.vendorId, inserted.id));

        const aggregateData: VendorAggregateData = {
            vendor: inserted,
            locations: locationRows,
        };

        const domainVendor = toDomainVendor(aggregateData);
        return { ...domainVendor, id: inserted.id } as Vendor & { id: string };
    }

    async updateReliabilityMetrics(
        id: string,
        metrics: {
            reliabilityScore?: number;
            cancellationRate?: number;
            averageProcessingTimeHours?: number;
        }
    ): Promise<void> {
        await db
            .update(vendors)
            .set({
                reliabilityScore: metrics.reliabilityScore ?? null,
                cancellationRate: metrics.cancellationRate ?? null,
                averageProcessingTimeHours: metrics.averageProcessingTimeHours ?? null,
                updatedAt: new Date(),
            })
            .where(eq(vendors.id, id));
    }
}
