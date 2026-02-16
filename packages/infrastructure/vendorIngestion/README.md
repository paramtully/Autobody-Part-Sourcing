# Vendor Inventory Ingestion Infrastructure

This package provides the infrastructure for ingesting vendor inventory data into the system. It implements a production-grade ingestion system with streaming support, payload fingerprinting, change detection, and strict separation of concerns.

## Architecture

### Components

1. **VendorInventoryClient** (`inventoryClient.ts`)
   - Interface for fetching vendor inventory data
   - Supports streaming and pagination
   - Handles retries, error classification, and health checks
   - Strictly fetch/normalize only (no DB writes)

2. **VendorInventoryDTO** (`dto/vendorInventoryDTO.ts`)
   - Normalized data transfer object for ingestion
   - Supports payload fingerprinting and change detection
   - Maps to domain listing + inventory models

3. **Zod Schema** (`inventorySchema.ts`)
   - Validates unreliable vendor data
   - Supports schema drift tolerance (passthrough)
   - Handles type coercion and partial data

4. **Change Detection** (`changeDetection/`)
   - Payload canonicalization and hashing
   - Vendor listing state tracking
   - Prevents unnecessary database writes

5. **Ingestion Pipeline** (`ingestion/`)
   - Architecture documentation
   - Interface definitions for future implementation

## Key Features

### Streaming Support
- Memory-efficient processing of large catalogs (100k+ listings)
- Async iterators for backpressure handling
- Resumable from cursor/offset

### Change Detection
- SHA-256 hash-based change detection
- Only writes when data actually changes
- Updates `lastSeenAt` for unchanged listings

### Idempotency
- Repository-level upserts
- Change detection prevents duplicates
- Raw payload storage is hash-deduplicated

### Schema Drift Tolerance
- Unknown fields preserved via `.passthrough()`
- New vendor fields don't break ingestion
- Graceful handling of missing/optional fields

### Error Resilience
- Single listing failures don't abort entire ingest
- Structured logging for all failures
- Graceful degradation

## Usage

### Implementing a Vendor Client

```typescript
import { VendorInventoryClient } from '@infrastructure/vendorIngestion';

class MyVendorClient implements VendorInventoryClient {
  async *fetchInventoryStream() {
    // Implement streaming logic
  }

  async fetchInventoryPage(cursor?: string) {
    // Implement pagination logic
  }

  async healthCheck() {
    // Implement health check
  }

  getVendorCapabilities() {
    // Return vendor capabilities
  }
}
```

### Using the DTO

```typescript
import { VendorInventoryDTO } from '@infrastructure/vendorIngestion';

const dto: VendorInventoryDTO = {
  vendorId: 'vendor-123',
  vendorListingExternalId: 'listing-456',
  // ... other fields
};
```

### Validating Vendor Responses

```typescript
import { validateVendorInventoryResponse } from '@infrastructure/vendorIngestion';

const response = await fetchVendorData();
const validated = validateVendorInventoryResponse(response);
```

### Canonicalizing and Hashing

```typescript
import { computePayloadHash, canonicalizePayload } from '@infrastructure/vendorIngestion';

const canonical = canonicalizePayload(payload);
const hash = computePayloadHash(payload);
```

## Testing

Comprehensive test suites are provided for:
- Client interface functionality
- DTO validation
- Schema validation
- Canonicalization
- Change detection

See `__tests__/` directories for test implementations.

## Documentation

- **Ingestion Pipeline**: See `ingestion/ingestionPipeline.md`
- **Polling Strategy**: See `pollingStrategy.md`
- **Architecture**: See the main plan document

## System Invariants

1. Vendor raw payloads are never mutated after storage
2. Inventory updates must be idempotent
3. No vendor failure can block ingestion from other vendors
4. Canonical part IDs must never be vendor-derived
5. All ingestion writes must be replayable
6. All relationships must be created via repository interfaces and must be idempotent

## Future Enhancements

- Webhook support for real-time updates
- Incremental updates (delta APIs)
- Priority-based polling
- Adaptive polling with ML
- Distributed processing
