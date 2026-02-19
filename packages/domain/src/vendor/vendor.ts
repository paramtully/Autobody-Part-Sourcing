import { VendorType } from "./vendorType";
import { IntegrationType } from "./integrationType";
import { VendorOrderingMode } from "../order/vendorOrderingMode";
import type WarehouseLocation from "../warehouseLocation/warehouseLocation";

export default interface Vendor {

    name: string;
    vendorType: VendorType;

    // Integration (inventory data channel)
    integrationType: IntegrationType;
    apiEndpoint?: string;

    // Ordering capability
    orderingMode: VendorOrderingMode;
    supportsCancellation: boolean;
    supportsStatusLookup: boolean;
    orderContactEmail?: string; // Required for EMAIL_MANUAL vendors

    // Geography
    warehouseLocations: WarehouseLocation[];

    // Commercial
    averageProcessingTimeHours?: number;

    // Quality metrics
    reliabilityScore?: number;
    cancellationRate?: number;

    // Business
    requiresManualOrdering?: boolean;

    createdAt: string;
    updatedAt: string;
}