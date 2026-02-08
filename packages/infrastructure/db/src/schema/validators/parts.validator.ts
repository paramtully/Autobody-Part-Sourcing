import { z } from 'zod';

export const partPositionSchema = z.enum([
    'FRONT_BUMPER',
    'REAR_BUMPER',
    'FRONT_LEFT_FENDER',
    'FRONT_RIGHT_FENDER',
    'REAR_LEFT_FENDER',
    'REAR_RIGHT_FENDER',
    'HOOD',
    'TRUNK',
    'FRONT_LEFT_DOOR',
    'FRONT_RIGHT_DOOR',
    'REAR_LEFT_DOOR',
    'REAR_RIGHT_DOOR',
    'ROOF',
    'QUARTER_PANEL_LEFT',
    'QUARTER_PANEL_RIGHT',
    'GRILLE',
    'HEADLIGHT_LEFT',
    'HEADLIGHT_RIGHT',
    'TAILLIGHT_LEFT',
    'TAILLIGHT_RIGHT',
    'MIRROR_LEFT',
    'MIRROR_RIGHT',
    'WINDSHIELD',
    'REAR_WINDOW',
    'SIDE_WINDOW_LEFT',
    'SIDE_WINDOW_RIGHT',
    'DOOR_HANDLE_LEFT',
    'DOOR_HANDLE_RIGHT',
    'FENDER_LINER_LEFT',
    'FENDER_LINER_RIGHT',
    'OTHER',
]);

export const partSchema = z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    position: partPositionSchema.optional(),
    description: z.string().optional(),
    weightGrams: z.number().int().positive().optional(),
    isDiscontinued: z.boolean().optional().default(false),
});

export const createPartSchema = partSchema;
