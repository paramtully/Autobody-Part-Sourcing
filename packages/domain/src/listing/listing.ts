import { PartCondition } from "./partCondition";
import type WarehouseLocation from "../warehouseLocation/warehouseLocation";
import { AvailabilityStatus } from "./availabilityStatus";
import { DataSourceType } from "./dataSourceType";
import { Currency } from "./currency";
import { Vendor } from "../vendor";
import { Part } from "../part";
import type ListingImage from "./listingImage";

export default interface Listing {

    id: string; // UUID (generated) -> might be useful for placing orders, otherwise remove

    vendor: Vendor;
    part: Part;

    // External identifiers for deduplication
    // Unique key: (vendorId, vendorListingExternalId) OR (vendorId, sourceUrl)
    vendorListingExternalId?: string; // Vendor's own ID for this listing
    sourceUrl?: string; // Where we found this listing

    // Listing attributes
    condition: PartCondition;
    description?: string; // Vendor's description of this specific listing
    images?: ListingImage[]; // Images associated with this listing

    // Source vehicle provenance (recycled parts only)
    sourceVehicleVin?: string;  // 17-char NHTSA VIN of donor vehicle
    sourceMileage?: number;     // Odometer at time of salvage
    sourceDamageType?: string;  // e.g. 'FRONT', 'REAR', 'FLOOD', 'ROLLOVER'

    // Current availability (updated on each ingestion)
    quantityAvailable?: number;
    availabilityStatus: AvailabilityStatus;

    // Current pricing (updated on each ingestion)
    priceMinorMin: number; // Min Price in minor units (cents for USD)
    priceMinorMax?: number; // If vendor provides price range
    currency: Currency;

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