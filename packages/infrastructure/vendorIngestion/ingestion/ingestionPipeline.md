# Ingestion Pipeline Architecture

## Overview

The ingestion pipeline orchestrates the flow from vendor client to database repositories, ensuring idempotency, replayability, and efficient change detection.

## Architecture Principles

1. **Strict Separation of Concerns**
   - Client layer: Fetch/normalize only (no DB writes, no deduplication)
   - Pipeline layer: Deduplication, change detection, persistence, events
   - Repository layer: Idempotent database operations

2. **Streaming-First Design**
   - Process large catalogs without loading into memory
   - Support backpressure and resumability
   - Batch processing for efficiency

3. **Idempotency Guarantees**
   - Change detection prevents unnecessary writes
   - Repository-level upserts handle conflicts
   - Raw payload storage is hash-deduplicated

4. **Error Resilience**
   - Single listing failures don't abort entire ingest
   - Structured logging for all failures
   - Graceful degradation

## Data Flow

```
Scheduler (EventBridge / Cron)
    ↓
Ingestion Worker (per vendor)
    ↓
VendorInventoryClient.fetchInventoryStream()
    ↓ (streaming, memory-efficient)
Zod Validation (per record)
    ↓
DTO Mapping + Canonicalization
    ↓
Payload Hash Computation
    ↓
Change Detection (VendorListingStateRepository)
    ↓
IF hash changed:
    Raw Payload Storage (conditional, via RawPayloadRepository)
    ↓
    Repository Upserts (idempotent):
        - ListingRepository.upsert/bulkUpsert
        - WarehouseLocationRepository.upsert + linkVendorToLocation
        - FitmentRepository.upsert + linkPartToFitment
        - InterchangeRepository.upsert
        - InterchangeMembershipRepository.upsert
        - ListingImageRepository.saveListingImages
    ↓
    InventoryUpdated Event (for downstream consumers)
ELSE:
    Update last_seen_at only (no writes)
```

## Pipeline Components

### 1. Ingestion Orchestrator

Coordinates the entire ingestion flow:
- Manages streaming from vendor client
- Handles batching for efficient processing
- Coordinates change detection
- Manages error handling and recovery

### 2. DTO Mapper

Transforms validated vendor records into `VendorInventoryDTO`:
- Maps vendor-specific fields to normalized DTO structure
- Handles missing/optional fields gracefully
- Computes canonical payload JSON
- Computes payload hash

### 3. Change Detector

Checks if listing data has changed:
- Queries `VendorListingStateRepository` by hash
- If hash matches: update `lastSeenAt` only
- If hash differs: proceed with repository writes

### 4. Repository Coordinator

Orchestrates repository upserts:
- Upserts listings via `ListingRepository`
- Upserts related entities (warehouse, fitment, interchange, images)
- Links relationships (part-fitment, vendor-warehouse, etc.)
- Handles partial failures gracefully

### 5. Event Emitter

Emits events for downstream consumers:
- `InventoryUpdated` event when listings change
- `IngestionCompleted` event when vendor ingest finishes
- `IngestionFailed` event for failures

## Error Handling Strategy

### Single Listing Failures

- Log error with structured logging (vendorId, listingId, error type)
- Continue processing remaining listings
- Emit failure event for monitoring
- Do NOT abort entire vendor ingest

### Partial Entity Failures

- If fitment upsert fails → listing still created
- If image save fails → listing still created
- If warehouse location fails → listing still created
- Log each failure separately
- Continue with other entities

### Retryable vs Non-Retryable Errors

- Retryable: timeouts, rate limits, 5xx errors, network failures
- Non-retryable: 4xx auth errors, validation errors (after retries)
- Client layer handles retries with exponential backoff
- Pipeline layer handles non-retryable errors gracefully

## Streaming Implementation

### Batch Processing

- Process records in batches (100-500 at a time)
- Use async iterators to avoid loading full catalog into memory
- Support configurable batch size per vendor

### Backpressure

- Pause stream when downstream is slow
- Resume when downstream catches up
- Don't buffer unlimited records

### Resumability

- Track cursor/offset for recovery
- Support resuming from failure point
- Don't reprocess already-ingested records

## Idempotency Mechanisms

### 1. Change Detection

- Hash comparison prevents writes for unchanged data
- Only update `lastSeenAt` when hash matches

### 2. Repository Upserts

- All repository methods use upsert semantics
- Conflict targets ensure no duplicates
- Idempotent on re-run

### 3. Raw Payload Storage

- Hash-based deduplication
- Same payload not stored twice
- Idempotent storage

## Replayability

### Raw Payload Replay

- Fetch stored raw payload from `RawPayloadRepository`
- Re-run ingestion pipeline with stored payload
- Produces same results as original ingestion (deterministic)

### Use Cases

- Debugging data issues
- Correcting ingestion bugs
- Auditing data changes
- Testing pipeline changes

## Performance Considerations

### Memory Efficiency

- Streaming prevents loading full catalog into memory
- Batch processing limits memory usage
- Garbage collection friendly

### Database Efficiency

- Change detection minimizes unnecessary writes
- Bulk upserts for efficiency
- Indexed queries for change detection

### Scalability

- Support 100k+ listings per vendor
- Concurrent ingestion from multiple vendors
- Horizontal scaling via workers

## Future Enhancements

1. **Webhook Support**
   - Real-time updates from vendors
   - Push-based ingestion

2. **Incremental Updates**
   - Vendors that send only changes
   - Optimize for delta processing

3. **Priority-Based Polling**
   - High-value vendors polled more frequently
   - Dynamic polling frequency adjustment

4. **Distributed Processing**
   - Multi-worker ingestion
   - Partition vendors across workers
