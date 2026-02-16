/**
 * Ingestion Pipeline Architecture
 * 
 * This file defines the interface and types for the ingestion pipeline.
 * The actual implementation will be created in a future phase.
 * 
 * See ingestionPipeline.md for detailed architecture documentation.
 */

import type { VendorInventoryClient } from '../inventoryClient';
import type { VendorInventoryDTO } from '../dto/vendorInventoryDTO';
import type { VendorListingStateRepository } from '../changeDetection/vendorListingStateRepository';
import type { RawPayloadRepository } from '@interfaces/repositories/rawPayloadRepository';
import type { ListingRepository } from '@interfaces/repositories/listingRepository';
import type { WarehouseLocationRepository } from '@interfaces/repositories/warehouseLocationRepository';
import type { FitmentRepository } from '@interfaces/repositories/fitmentRepository';
import type { InterchangeRepository } from '@interfaces/repositories/interchangeRepository';
import type { InterchangeMembershipRepository } from '@interfaces/repositories/interchangeMembershipRepository';
import type { ListingImageRepository } from '@interfaces/repositories/listingImageRepository';

/**
 * Configuration for ingestion pipeline.
 */
export interface IngestionPipelineConfig {
  vendorId: string;
  batchSize?: number; // Default: 500
  maxBatchSize?: number; // Maximum: 1000
  enableRawPayloadStorage?: boolean; // Default: true
  rawPayloadSamplingRate?: number; // 0-1, default: 1.0 (store all changed payloads)
}

/**
 * Result of processing a single listing.
 */
export interface ListingProcessResult {
  listingId?: string;
  success: boolean;
  skipped: boolean; // True if skipped due to unchanged hash
  error?: string;
  relatedEntitiesCreated: {
    warehouseLocation?: boolean;
    fitment?: boolean;
    interchange?: boolean;
    interchangeMembership?: boolean;
    images?: boolean;
  };
}

/**
 * Result of entire ingestion run.
 */
export interface IngestionResult {
  vendorId: string;
  totalProcessed: number;
  totalSucceeded: number;
  totalSkipped: number;
  totalFailed: number;
  results: ListingProcessResult[];
  rawPayloadId?: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
}

/**
 * Ingestion pipeline interface.
 * 
 * Orchestrates the flow from vendor client to database repositories.
 */
export interface IngestionPipeline {
  /**
   * Process inventory from a vendor client.
   * 
   * @param client - Vendor inventory client
   * @param config - Pipeline configuration
   * @returns Ingestion result with statistics
   */
  processInventory(
    client: VendorInventoryClient,
    config: IngestionPipelineConfig
  ): Promise<IngestionResult>;

  /**
   * Replay ingestion from a stored raw payload.
   * 
   * @param rawPayloadId - ID of stored raw payload
   * @param config - Pipeline configuration
   * @returns Ingestion result with statistics
   */
  replayFromRawPayload(
    rawPayloadId: string,
    config: IngestionPipelineConfig
  ): Promise<IngestionResult>;
}

/**
 * Dependencies required for ingestion pipeline.
 */
export interface IngestionPipelineDependencies {
  vendorListingStateRepository: VendorListingStateRepository;
  rawPayloadRepository: RawPayloadRepository;
  listingRepository: ListingRepository;
  warehouseLocationRepository: WarehouseLocationRepository;
  fitmentRepository: FitmentRepository;
  interchangeRepository: InterchangeRepository;
  interchangeMembershipRepository: InterchangeMembershipRepository;
  listingImageRepository: ListingImageRepository;
}
