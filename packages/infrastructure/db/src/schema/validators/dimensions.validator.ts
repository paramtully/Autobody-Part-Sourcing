import { z } from 'zod';

export const dimensionsSchema = z.object({
  partId: z.string().uuid(),
  lengthMM: z.number().int().positive(),
  widthMM: z.number().int().positive(),
  heightMM: z.number().int().positive(),
});

export const createDimensionsSchema = dimensionsSchema;
