/**
 * Vendor inventory ingestion infrastructure.
 * 
 * This package provides:
 * - VendorInventoryClient interface for fetching vendor data
 * - VendorInventoryDTO for normalized ingestion data
 * - Zod schemas for vendor response validation
 * - Change detection utilities
 * - Ingestion pipeline architecture
 */

export * from './inventoryClient';
export * from './dto/vendorInventoryDTO';
export * from './inventorySchema';
export * from './changeDetection/vendorListingState';
export * from './changeDetection/vendorListingStateRepository';
export * from './changeDetection/canonicalizer';
export * from './ingestion/ingestionPipeline';
