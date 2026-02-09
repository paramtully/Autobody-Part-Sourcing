import type Part from '@domain/part/part';
import type Dimensions from '@domain/part/dimensions';
import type { PartIdentifier } from '@domain/part/partIdentifier';
import { PartCategory } from '@domain/part/partCategory';
import { PartPosition } from '@domain/part/partPosition';
import type { parts, partIdentifiers, partDimensions } from '../schema';

type PartRow = typeof parts.$inferSelect;
type PartIdentifierRow = typeof partIdentifiers.$inferSelect;
type PartDimensionsRow = typeof partDimensions.$inferSelect;
type PartInsert = typeof parts.$inferInsert;

/**
 * Aggregate part data with identifiers and dimensions into domain Part
 */
export interface PartAggregateData {
    part: PartRow;
    identifiers: PartIdentifierRow[];
    dimensions?: PartDimensionsRow | null;
}

/**
 * Convert aggregated part data to domain Part
 */
export function toDomainPart(data: PartAggregateData): Part {
    const { part, identifiers, dimensions } = data;

    const domainIdentifiers: PartIdentifier[] = identifiers.map((id) => ({
        type: id.type,
        value: id.value,
        manufacturer: id.manufacturer,
        certification: id.certification ?? undefined,
        createdAt: id.createdAt,
    }));

    const domainDimensions: Dimensions | undefined = dimensions
        ? {
              lengthMM: dimensions.lengthMM,
              widthMM: dimensions.widthMM,
              heightMM: dimensions.heightMM,
          }
        : undefined;

    return {
        name: part.name,
        category: part.category as PartCategory,
        position: (part.position as PartPosition) ?? undefined,
        description: part.description ?? undefined,
        weightGrams: part.weightGrams ?? undefined,
        dimensions: domainDimensions,
        partIdentifiers: domainIdentifiers,
        isDiscontinued: part.isDiscontinued ?? undefined,
        createdAt: part.createdAt,
        updatedAt: part.updatedAt,
    };
}

/**
 * Convert domain Part to database insert format (without identifiers and dimensions)
 */
export function toDbPartInsert(
    part: Omit<Part, 'createdAt' | 'updatedAt' | 'partIdentifiers' | 'dimensions'>
): PartInsert {
    return {
        name: part.name,
        category: part.category,
        position: part.position ?? null,
        description: part.description ?? null,
        weightGrams: part.weightGrams ?? null,
        isDiscontinued: part.isDiscontinued ?? false,
    };
}
