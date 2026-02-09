import { db } from '../db';
import { listingImages } from '../schema';
import { eq, inArray, asc } from 'drizzle-orm';
import type { ListingImageRepository } from '@interfaces/repositories/listingImageRepository';
import type ListingImage from '@domain/listing/listingImage';
import { toDomainListingImage, toDbListingImageInsert } from '../mappers';

export class ListingImageRepositoryImpl implements ListingImageRepository {
    async saveListingImages(listingId: string, images: ListingImage[]): Promise<void> {
        // Use transaction to ensure atomicity
        await db.transaction(async (tx) => {
            // Delete existing images
            await tx.delete(listingImages).where(eq(listingImages.listingId, listingId));

            // Insert new images
            if (images.length > 0) {
                await tx.insert(listingImages).values(
                    images.map((image, index) =>
                        toDbListingImageInsert(listingId, image, index)
                    )
                );
            }
        });
    }

    async getListingImages(listingId: string): Promise<ListingImage[]> {
        const rows = await db
            .select()
            .from(listingImages)
            .where(eq(listingImages.listingId, listingId))
            .orderBy(asc(listingImages.sortOrder), asc(listingImages.createdAt));

        return rows.map((row) => toDomainListingImage(row));
    }

    async getListingImagesBatch(listingIds: string[]): Promise<Map<string, ListingImage[]>> {
        if (listingIds.length === 0) {
            return new Map();
        }

        const rows = await db
            .select()
            .from(listingImages)
            .where(inArray(listingImages.listingId, listingIds))
            .orderBy(asc(listingImages.sortOrder), asc(listingImages.createdAt));

        // Group by listingId
        const result = new Map<string, ListingImage[]>();
        for (const row of rows) {
            const images = result.get(row.listingId) || [];
            images.push(toDomainListingImage(row));
            result.set(row.listingId, images);
        }

        // Ensure all listingIds are in the map (even if empty)
        for (const listingId of listingIds) {
            if (!result.has(listingId)) {
                result.set(listingId, []);
            }
        }

        return result;
    }

    async deleteListingImages(listingId: string): Promise<void> {
        await db.delete(listingImages).where(eq(listingImages.listingId, listingId));
    }
}
