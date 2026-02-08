import { z } from 'zod';

export const partIdentifierTypeSchema = z.enum(['OEM', 'AFTERMARKET']);

export const certificationSchema = z.enum(['CAPA', 'NSF']);

export const partIdentifierSchema = z.object({
  partId: z.string().uuid(),
  type: partIdentifierTypeSchema,
  value: z.string().min(1),
  manufacturer: z.string().min(1),
  certification: certificationSchema.optional(),
});

export const createPartIdentifierSchema = partIdentifierSchema;
