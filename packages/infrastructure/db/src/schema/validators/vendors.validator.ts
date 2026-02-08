import { z } from 'zod';

export const vendorTypeSchema = z.enum([
  'OEM',
  'AFTERMARKET',
  'SALVAGE',
  'MARKETPLACE',
]);

export const integrationTypeSchema = z.enum([
  'API',
  'CSV',
  'SCRAPER',
  'MANUAL',
]);

export const vendorSchema = z.object({
  name: z.string().min(1),
  vendorType: vendorTypeSchema,
  integrationType: integrationTypeSchema,
  apiEndpoint: z.string().url().optional(),
  averageProcessingTimeHours: z.number().positive().optional(),
  reliabilityScore: z.number().min(0).max(1).optional(),
  cancellationRate: z.number().min(0).max(1).optional(),
  requiresManualOrdering: z.boolean().optional().default(false),
});

export const createVendorSchema = vendorSchema;
