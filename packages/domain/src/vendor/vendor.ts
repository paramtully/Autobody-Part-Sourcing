import { VendorType } from "./vendorType";
import { IntegrationType } from "./integrationType";
import type WarehouseLocation from "../warehouseLocation/warehouseLocation";

export default interface Vendor {

    name: string;
    vendorType: VendorType;

    // Integration
    integrationType: IntegrationType;
    apiEndpoint?: string;

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