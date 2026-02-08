import type Dimensions from "./dimensions";
import { PartIdentifier } from "./partIdentifier";
import { PartPosition } from "./partPosition";

export default interface Part {
  
    // part attributes
    name: string;
    category: string;
    position?: PartPosition;
    description?: string;

    // Physical properties
    weightGrams?: number;
    dimensions?: Dimensions;

    // Interchangeability
    partIdentifiers: PartIdentifier[];

    // Lifecycle
    isDiscontinued?: boolean;
  
    // Metadata
    createdAt: Date;
    updatedAt: Date;
}
  