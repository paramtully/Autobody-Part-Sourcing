import { z } from 'zod';

export const fitmentConstraintSchema = z.enum([
    'WITH_RADAR',
    'WITHOUT_RADAR',
    'WITH_PARKING_SENSORS',
    'WITHOUT_PARKING_SENSORS',
    'WITH_CAMERA',
    'WITHOUT_CAMERA',
    'LED',
    'HALOGEN',
    'HID',
    'ADAPTIVE',
    'SUNROOF',
    'NO_SUNROOF',
    'AWD',
    'FWD',
    'RWD',
]);

// Normalized fitment schema (one row per combination)
export const fitmentRowSchema = z.object({
    make: z.string().min(1),
    model: z.string().min(1),
    year: z.number().int().min(1900).max(2100),
    constraint: fitmentConstraintSchema.optional().nullable(),
    trim: z.string().min(1).optional().nullable(),
    engine: z.string().min(1).optional().nullable(),
});

export const createFitmentRowSchema = fitmentRowSchema;

export const partFitmentSchema = z.object({
    partId: z.string().uuid(),
    fitmentId: z.string().uuid(),
});

export const createPartFitmentSchema = partFitmentSchema;
