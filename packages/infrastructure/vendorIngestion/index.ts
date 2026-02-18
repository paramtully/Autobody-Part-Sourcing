/**
 * Vendor Ingestion Pipeline
 *
 * Production-grade data ingestion infrastructure for collision parts sourcing.
 * Designed for Vercel serverless with chunked execution + checkpoint/resume.
 *
 * Systems:
 * 1. VendorInventoryClient  - Fetch raw vendor data (API, scraper, CSV)
 * 2. RetryableVendorClient  - Decorator for retry + circuit breaker + rate limiting
 * 3. RawPayloadLogger       - Append-only audit log with retention policy
 * 4. DTOMapper              - Raw vendor records → VendorInventoryDTO
 * 5a. DataCleaner           - Stateless validation + normalization → CleanedDTO
 * 5b. DomainReconciler      - Stateful DB comparison → INSERT/UPDATE/SKIP/CONFLICT
 * 6. ListingLifecycleManager - Stale listing detection + deactivation
 * 7. IngestionOrchestrator   - Composes all systems; chunked execution per Vercel Cron tick
 *
 * Any system can be removed without affecting others.
 * All dependencies are injected via interfaces.
 */

// System 1: Vendor Inventory Client
export * from './inventoryClient';
export * from './inventorySchema';

// System 2: Retry + Resilience Utilities
export * from './utils/retry';

// System 3: Raw Payload Logging
export * from './logging';

// System 4: DTO Mapping
export * from './dto/vendorInventoryDTO';

// System 5a: Data Cleaning
export * from './cleaning';

// System 5b: Domain Reconciliation
export * from './reconciliation';

// System 6: Listing Lifecycle
export * from './lifecycle';

// System 7: Ingestion Orchestrator
export * from './ingestion/ingestionOrchestrator';
export * from './ingestion/ingestionRun';
export * from './ingestion/ingestionResult';
export * from './ingestion/ingestionPipeline';

// Ingestion Repository & Persistence Service
export * from './ingestionRepository/ingestionRepository';
export * from './ingestionRepository/consistencyResult';
export * from './ingestionRepository/consistencyChecker';
export * from './ingestionRepository/entityExtractor';
export * from './ingestionRepository/ingestionPersistenceService';

// Change Detection
export * from './changeDetection/vendorListingState';
export * from './changeDetection/vendorListingStateRepository';
export * from './changeDetection/canonicalizer';
