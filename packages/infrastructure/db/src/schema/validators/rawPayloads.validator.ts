import { z } from 'zod';

export const rawPayloadStatusSchema = z.enum(['PENDING', 'PROCESSED', 'FAILED']);

export const rawPayloadSchema = z.object({
    vendorId: z.string().uuid(),
    payload: z.record(z.unknown()), // JSONB - structure varies by vendor
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/i, 'Must be a valid SHA-256 hash'),
    status: rawPayloadStatusSchema,
    errorMessage: z.string().optional().nullable(),
    vendorListingExternalId: z.string().min(1).optional().nullable(),
    ingestionRunId: z.string().uuid().optional().nullable(),
    retainUntil: z.date().optional().nullable(),
});

export const createRawPayloadSchema = rawPayloadSchema.omit({ status: true }).extend({
    status: rawPayloadStatusSchema.optional().default('PENDING'),
});
