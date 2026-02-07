import { PartCondition } from "./partCondition";

export default interface Listing {
    id: string; // use either externalListingId for listing or hash(vendorId, externalListingId or url)
  
    vendorId: string;
    partId: string;
  
    vendorListingExternalId?: string;
  
    condition: PartCondition;
  
    sourceUrl?: string;
    contentHash?: string;
  
    isActive: boolean;
  
    createdAt: Date;
    updatedAt: Date;
}