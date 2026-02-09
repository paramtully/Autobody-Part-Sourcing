import { z } from 'zod';

export const warehouseLocationSchema = z.object({
    country: z.string().min(1), // Could be enhanced with ISO country code validation
    stateOrProvince: z.string().optional(),
    city: z.string().optional(),
    postalCode: z.string().optional(),
});

export const createWarehouseLocationSchema = warehouseLocationSchema;

export const vendorWarehouseLocationSchema = z.object({
    vendorId: z.string().uuid(),
    warehouseLocationId: z.string().uuid(),
});

export const createVendorWarehouseLocationSchema = vendorWarehouseLocationSchema;
