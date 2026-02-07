import { VendorType } from "./vendorType";
import { IntegrationType } from "./integrationType";
import type WarehouseLocation from "../warehouseLocation/warehouseLocation";

export default interface Vendor {
    id: string;

    name: string;
    vendorType: VendorType;

    // Integration
    integrationType: IntegrationType;
    apiEndpoint?: string;

    // Geography
    warehouseLocations: WarehouseLocation[];

    // Commercial
    supportsDropshipping: boolean;
    averageProcessingTimeHours?: number;

    // Quality metrics
    reliabilityScore?: number;
    cancellationRate?: number;

    // Business
    requiresManualOrdering?: boolean;

    createdAt: string;
    updatedAt: string;
}