import { PartCategory } from "./partCategory";
import type VehicleFitment from "./vehicleFitment";
import type Dimensions from "./dimensions";

export default interface Part {
    id: string; // internal UUID
  
    // Classification
    name: string;
    category: PartCategory;
    position: number;
    description?: string;
  
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
  