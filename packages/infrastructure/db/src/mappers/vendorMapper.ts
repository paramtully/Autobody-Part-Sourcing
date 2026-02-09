import type Vendor from '@domain/vendor/vendor';
import { VendorType } from '@domain/vendor/vendorType';
import { IntegrationType } from '@domain/vendor/integrationType';
import type WarehouseLocation from '@domain/warehouseLocation/warehouseLocation';
import type { vendors, warehouseLocations, vendorWarehouseLocations } from '../schema';
import { toDomainWarehouseLocation } from './warehouseLocationMapper';

type VendorRow = typeof vendors.$inferSelect;
type WarehouseLocationRow = typeof warehouseLocations.$inferSelect;
type VendorInsert = typeof vendors.$inferInsert;

/**
 * Aggregate vendor data with warehouse locations
 */
export interface VendorAggregateData {
    vendor: VendorRow;
    locations: Array<{
        warehouseLocation: WarehouseLocationRow;
    }>;
}

/**
 * Convert aggregated vendor data to domain Vendor
 */
export function toDomainVendor(data: VendorAggregateData): Vendor {
    const { vendor, locations } = data;

    const warehouseLocations: WarehouseLocation[] = locations.map((loc) =>
        toDomainWarehouseLocation(loc.warehouseLocation)
    );

    return {
        name: vendor.name,
        vendorType: vendor.vendorType as VendorType,
        integrationType: vendor.integrationType as IntegrationType,
        apiEndpoint: vendor.apiEndpoint ?? undefined,
        warehouseLocations,
        averageProcessingTimeHours: vendor.averageProcessingTimeHours ?? undefined,
        reliabilityScore:
            vendor.reliabilityScore !== null ? Number(vendor.reliabilityScore) : undefined,
        cancellationRate:
            vendor.cancellationRate !== null ? Number(vendor.cancellationRate) : undefined,
        requiresManualOrdering: vendor.requiresManualOrdering ?? undefined,
        createdAt: vendor.createdAt.toISOString(),
        updatedAt: vendor.updatedAt.toISOString(),
    };
}

/**
 * Convert domain Vendor to database insert format (without warehouse locations)
 */
export function toDbVendorInsert(
    vendor: Omit<Vendor, 'warehouseLocations' | 'createdAt' | 'updatedAt'>
): VendorInsert {
    return {
        name: vendor.name,
        vendorType: vendor.vendorType,
        integrationType: vendor.integrationType,
        apiEndpoint: vendor.apiEndpoint ?? null,
        averageProcessingTimeHours: vendor.averageProcessingTimeHours ?? null,
        reliabilityScore: vendor.reliabilityScore ?? null,
        cancellationRate: vendor.cancellationRate ?? null,
        requiresManualOrdering: vendor.requiresManualOrdering ?? false,
    };
}
