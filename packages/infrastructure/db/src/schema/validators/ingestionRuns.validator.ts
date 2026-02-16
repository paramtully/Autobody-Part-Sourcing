import { z } from 'zod';

export const ingestionRunStatusSchema = z.enum([
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
]);

export const ingestionRunStatsSchema = z.object({
    processed: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    conflicted: z.number().int().nonnegative(),
    pagesFetched: z.number().int().nonnegative(),
});

export const ingestionRunSchema = z.object({
    vendorId: z.string().uuid(),
    status: ingestionRunStatusSchema,
    lastCursor: z.string().nullable().optional(),
    stats: ingestionRunStatsSchema,
    errorMessage: z.string().nullable().optional(),
});

export const createIngestionRunSchema = ingestionRunSchema.omit({ status: true }).extend({
    status: ingestionRunStatusSchema.optional().default('IN_PROGRESS'),
});
