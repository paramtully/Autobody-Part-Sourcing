import type ListingImage from '@domain/listing/listingImage';

/**
 * Repository interface for ListingImage domain operations.
 * Does not leak database implementation details.
 */
export interface ListingImageRepository {
    /**
     * Save images for a listing.
     * Replaces all existing images for the listing with the new ones.
     * @param listingId - The listing ID
     * @param images - Array of images to save
     */
    saveListingImages(listingId: string, images: ListingImage[]): Promise<void>;

    /**
     * Get all images for a listing, sorted by sortOrder.
     * @param listingId - The listing ID
     * @returns Array of ListingImage objects
     */
    getListingImages(listingId: string): Promise<ListingImage[]>;

    /**
     * Get images for multiple listings in a single query.
     * @param listingIds - Array of listing IDs
     * @returns Map of listing ID to array of ListingImage objects
     */
    getListingImagesBatch(listingIds: string[]): Promise<Map<string, ListingImage[]>>;

    /**
     * Delete all images for a listing.
     * @param listingId - The listing ID
     */
    deleteListingImages(listingId: string): Promise<void>;
}
