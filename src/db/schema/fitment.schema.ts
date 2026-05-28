import { z } from 'zod';
import { fitmentConstraintEnum, partCategoryEnum, partPositionEnum } from '../models/enums';

export const fitmentSchema = z.looseObject({
    make: z.string().trim().transform((val: unknown) => val?.toString().trim().toUpperCase()),
    model: z.string().trim().transform((val: unknown) => val?.toString().trim().toUpperCase()),
    year: z.coerce.number().int().positive(),

    category: z.enum(partCategoryEnum.enumValues).optional().nullable().transform(val => val?.toString().trim().toUpperCase()),
    position: z.enum(partPositionEnum.enumValues).optional().nullable().transform(val => val?.toString().trim().toUpperCase()),
    constraint: z.enum(fitmentConstraintEnum.enumValues).optional().nullable().transform(val => val?.toString().trim().toUpperCase()),

    trim: z.string().trim().toUpperCase().optional().nullable().transform(val => val?.toString().trim().toUpperCase()),
    engine: z.string().trim().toUpperCase().optional().nullable().transform(val => val?.toString().trim().toUpperCase()),
});

export type Fitment = z.infer<typeof fitmentSchema>;