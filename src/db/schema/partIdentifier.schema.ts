import { z } from 'zod';

export function normalizePartIdentifierValue(value: string): string {
    return value.trim().replace(/-/g, '').toUpperCase();
}

export const partIdentifierSchema = z.object({
    type: z.enum(['OEM', 'AFTERMARKET', 'INTERCHANGE']),
    value: z.string().transform(normalizePartIdentifierValue).pipe(z.string().min(1)),
    manufacturer: z.string().optional(),
    certification: z.enum(['CAPA', 'NSF']).optional(),
});
