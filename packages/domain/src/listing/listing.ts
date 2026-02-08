import { PartCondition } from "./partCondition";

export default interface Listing {
    id: string; // use either externalListingId for listing or hash(vendorId, externalListingId or url)
  
    vendorId: string;
    partId: string;
  
    // External identifiers for deduplication
    vendorListingExternalId?: string; // Vendor's own ID for this listing
    sourceUrl?: string; // Where we found this listing
    
    // Listing-level attributes (don't change frequently)
    condition: PartCondition;
    
    // Deduplication & change detection
    contentHash?: string; // Hash of listing attributes for change detection
    
    // Lifecycle
    isActive: boolean; // Soft delete - listing may disappear and reappear
  
    // Ingestion tracking
    createdAt: Date;
    updatedAt: Date;
}