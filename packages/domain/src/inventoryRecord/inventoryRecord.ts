import type WarehouseLocation from "../warehouseLocation/warehouseLocation";
import { AvailabilityStatus } from "./availabilityStatus";
import { DataSourceType } from "./dataSourceType";
import { Currency } from "./currency";

export default interface InventoryRecord {
    id: string;

    listingId: string;

    // Availability
    quantityAvailable?: number;
    availabilityStatus: AvailabilityStatus;

    // Pricing
    priceMinor: number; // price in minor units of the currency (e.g. cents for USD)
    currency: Currency;

    // Logistics
    warehouseLocation?: WarehouseLocation;
    estimatedShipTimeHours?: number;

    // Source + freshness
    source: DataSourceType;
    lastVerifiedAt: Date;
    confidenceScore?: number;

    createdAt: Date;
}
