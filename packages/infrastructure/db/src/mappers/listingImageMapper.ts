import type ListingImage from '@domain/listing/listingImage';
import type { listingImages } from '../schema';

type ListingImageRow = typeof listingImages.$inferSelect;
type ListingImageInsert = typeof listingImages.$inferInsert;

/**
 * Convert database row to domain ListingImage
 */
export function toDomainListingImage(row: ListingImageRow): ListingImage {
    return {
        url: row.url,
        type: (row.imageType as ListingImage['type']) ?? undefined,
        source: row.source ?? undefined,
    };
}

/**
 * Convert domain ListingImage to database insert format
 */
export function toDbListingImageInsert(
    listingId: string,
    image: ListingImage,
    sortOrder: number
): ListingImageInsert {
    return {
        listingId,
        url: image.url,
        imageType: image.type ?? null,
        source: image.source ?? null,
        sortOrder,
    };
}
