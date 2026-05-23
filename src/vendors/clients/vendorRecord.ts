import { partConditionEnum, availabilityStatusEnum, fitmentConstraintEnum } from "../../db/models/enums";

export type PartCondition = (typeof partConditionEnum.enumValues)[number];
// 'NEW_OEM' | 'NEW_AFTERMARKET' | 'RECYCLED' | 'REMANUFACTURED' | 'RECONDITIONED' | 'UNKNOWN'

export type AvailabilityStatus = (typeof availabilityStatusEnum.enumValues)[number];
// 'IN_STOCK' | 'LOW_STOCK' | 'BACKORDER' | 'SPECIAL_ORDER' | 'UNKNOWN'

export type FitmentConstraint = (typeof fitmentConstraintEnum.enumValues)[number];

export type UnknownRawVendorRecord = unknown;

export interface VendorRecord {
    part: {
      name: string;
      category: string;
      position?: string;
      description?: string;
      weightGrams?: number;
    };
    // At least one identifier required — listing is rejected if empty
    identifiers: Array<{
      type: 'OEM' | 'AFTERMARKET' | 'INTERCHANGE';
      value: string;
      manufacturer?: string;    // e.g. "Honda", "TYC", "Depo" — brand lives here
      certification?: 'CAPA' | 'NSF';
    }>;
    fitments: Array<{
      make: string;
      model: string;
      year: number;
      trim?: string;
      engine?: string;
      constraint?: FitmentConstraint;
    }>;
    listing: {
      vendorListingExternalId: string;
      sourceUrl?: string;
      condition: PartCondition;         // NEW_OEM | NEW_AFTERMARKET | RECYCLED | REMANUFACTURED | RECONDITIONED | UNKNOWN
      description?: string;
      quantityAvailable?: number;
      availabilityStatus: AvailabilityStatus;
      priceMinorMin: number;
      priceMinorMax?: number;
      currency: string;
      sourceVehicleVin?: string;        // salvage provenance
      sourceMileage?: number;
      sourceDamageType?: string;
      estimatedShipTimeHours?: number;
      images?: Array<{ url: string; type?: string }>;
      warehouseLocation?: { country: string; stateOrProvince?: string; city?: string; postalCode?: string };
    };
  }