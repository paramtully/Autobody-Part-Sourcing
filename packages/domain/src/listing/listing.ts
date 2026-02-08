import { PartCondition } from "./partCondition";
import type WarehouseLocation from "../warehouseLocation/warehouseLocation";
import { AvailabilityStatus } from "./availabilityStatus";
import { DataSourceType } from "./dataSourceType";
import { Currency } from "./currency";

export default interface Listing {
    id: string; // UUID (generated)

    vendorId: string;
    partId: string;

    // External identifiers for deduplication
    // Unique key: (vendorId, vendorListingExternalId) OR (vendorId, sourceUrl)
    vendorListingExternalId?: string; // Vendor's own ID for this listing
    sourceUrl?: string; // Where we found this listing

    // Listing attributes
    condition: PartCondition;
    description?: string; // Vendor's description of this specific listing

    // Current availability (updated on each ingestion)
    quantityAvailable?: number;
    availabilityStatus: AvailabilityStatus;

    // Current pricing (updated on each ingestion)
    priceMinor: number; // Price in minor units (cents for USD)
    currency: Currency;
    priceMinorMax?: number; // If vendor provides price range

    // Current logistics (updated on each ingestion)
    warehouseLocation?: WarehouseLocation;
    estimatedShipTimeHours?: number;
    estimatedDeliveryDate?: Date; // Alternative to hours

    // Data quality
    source: DataSourceType;
    lastVerifiedAt: Date; // When this data was last updated
    confidenceScore?: number; // Data quality score (0-1)

    // Lifecycle
    isActive: boolean; // Soft delete - listing may disappear and reappear

    // Ingestion tracking
    createdAt: Date;
    updatedAt: Date;
}