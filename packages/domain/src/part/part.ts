import { PartCategory } from "./partCategory";
import type VehicleFitment from "./vehicleFitment";
import type Dimensions from "./dimensions";

export default interface Part {
    id: string; // internal UUID
  
    // Industry identifiers
    oemPartNumber?: string;
    aftermarketPartNumber?: string;
    interchangePartNumbers?: Set<string>;
  
    // Classification
    name: string;
    description?: string;
    category: PartCategory;
  
    // Fitment
    compatibleVehicles: Set<VehicleFitment>;
  
    // Physical properties
    weightGrams?: number;
    dimensionsMillimeters?: Dimensions;
  
    // Lifecycle
    isDiscontinued?: boolean;
  
    // Metadata
    createdAt: Date;
    updatedAt: Date;
}
  