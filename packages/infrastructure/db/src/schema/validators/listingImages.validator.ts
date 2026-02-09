import { z } from 'zod';

export const listingImageTypeSchema = z.enum([
    'PRIMARY',
    'ANGLE',
    'DAMAGE',
    'STOCK',
]);

export const listingImageSchema = z.object({
    url: z.string().url(),
    imageType: listingImageTypeSchema.optional(),
    source: z.string().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
});

export const createListingImageSchema = listingImageSchema;
