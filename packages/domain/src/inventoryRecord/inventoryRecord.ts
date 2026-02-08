import { Currency } from "../listing/currency";

export default interface InventoryRecord {
    id: string;

    vendorId: string;
    partId: string;

    // Aggregate statistics across all listings for this vendor+part
    totalListingsCount: number; // How many listings this vendor has for this part
    activeListingsCount: number; // How many are currently active

    // Price range across all listings
    lowestPriceMinor?: number;
    highestPriceMinor?: number;
    currency?: Currency; // Assuming same currency across listings (or most common)

    // Total availability
    totalQuantityAvailable?: number; // Sum across all listings

    // Condition breakdown
    hasNewOem: boolean;
    hasNewAftermarket: boolean;
    hasRecycled: boolean;
    hasRemanufactured: boolean;
    hasReconditioned: boolean;
    hasUnknown: boolean;

    // Last update
    lastUpdatedAt: Date; // When any listing for this vendor+part was last updated

    // Metadata
    createdAt: Date;
    updatedAt: Date;

    // Unique: (vendorId, partId)
}
