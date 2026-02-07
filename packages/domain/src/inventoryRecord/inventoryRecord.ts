import type WarehouseLocation from "../warehouseLocation/warehouseLocation";
import { AvailabilityStatus } from "./availabilityStatus";
import { DataSourceType } from "./dataSourceType";

export default interface InventoryRecord {
    id: string;

    partId: string;
    vendorId: string;

    // Availability
    quantityAvailable?: number;
    availabilityStatus: AvailabilityStatus;

    // Pricing
    priceMinor: number; // price in minor units of the currency (e.g. cents for USD)
    currency: string;

    // Logistics
    warehouseLocation?: WarehouseLocation;
    estimatedShipTimeHours?: number;

    // Source + freshness
    source: DataSourceType;
    lastVerifiedAt: Date;
    confidenceScore?: number;

    // Ordering
    orderUrl?: string;
    supportsInstantOrder?: boolean;

    createdAt: Date;
    updatedAt: Date;
}
