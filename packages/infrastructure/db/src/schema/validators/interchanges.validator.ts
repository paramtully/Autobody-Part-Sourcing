import { z } from 'zod';

export const interchangeSystemSchema = z.enum([
    'HOLLANDER',
    'OPTICAT',
    'CCC',
    'LKQ',
    'VENDOR',
    'UNKNOWN',
]);

export const interchangeSchema = z.object({
    system: interchangeSystemSchema,
    code: z.string().min(1),
});

export const createInterchangeSchema = interchangeSchema;

export const interchangeMembershipSchema = z.object({
    partId: z.string().uuid(),
    interchangeId: z.string().uuid(),
    confidence: z.number().min(0).max(1).optional(),
    source: z.string().optional(),
});

export const createInterchangeMembershipSchema = interchangeMembershipSchema;
