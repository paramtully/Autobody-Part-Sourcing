/**
 * DTOMapper factory for creating vendor-specific mapper instances.
 *
 * Most vendors work with the DefaultDTOMapper. Some vendors
 * (e.g., LKQ with part grades, CCC with quality tiers) may
 * need custom mappers that override specific mapping methods.
 *
 * The factory returns the correct mapper for a given vendorId.
 */

import type { DTOMapper } from './dtoMapper';
import { DefaultDTOMapper } from './dtoMapper';

/**
 * Registry of vendor-specific DTOMapper implementations.
 */
const mapperRegistry = new Map<string, () => DTOMapper>();

/**
 * Register a vendor-specific DTOMapper factory.
 *
 * @param vendorId - The vendor identifier
 * @param factory - Factory function that creates the mapper
 */
export function registerDTOMapper(vendorId: string, factory: () => DTOMapper): void {
    mapperRegistry.set(vendorId, factory);
}

/**
 * Get a DTOMapper for a given vendor.
 *
 * Returns the vendor-specific mapper if registered,
 * otherwise returns a DefaultDTOMapper.
 *
 * @param vendorId - The vendor identifier
 * @param dataSource - Data source type for the default mapper
 * @returns DTOMapper instance for this vendor
 */
export function getDTOMapper(
    vendorId: string,
    dataSource: 'VENDOR_API' | 'SCRAPER' | 'CSV_UPLOAD' | 'MANUAL_ENTRY' = 'VENDOR_API'
): DTOMapper {
    const factory = mapperRegistry.get(vendorId);
    if (factory) {
        return factory();
    }
    return new DefaultDTOMapper(dataSource);
}

/**
 * Clear all registered mappers (for testing).
 */
export function clearDTOMapperRegistry(): void {
    mapperRegistry.clear();
}
