# Production Reliability Analysis - Database Schema

## 1. Data Corruption Risks

### Critical

**1.1 Missing Partial Unique Indexes on Listings**
- **Risk**: Without the partial unique indexes (commented in schema), duplicate listings can be inserted if both `vendorListingExternalId` and `sourceUrl` are NULL or if one is NULL and retries occur
- **Impact**: Duplicate inventory entries, incorrect availability counts, price discrepancies
- **Location**: `listings.ts` lines 38-43
- **Mitigation**: Create partial unique indexes in migration:
  ```sql
  CREATE UNIQUE INDEX listings_vendor_external_id_unique 
    ON listings (vendor_id, vendor_listing_external_id) 
    WHERE vendor_listing_external_id IS NOT NULL;
  CREATE UNIQUE INDEX listings_vendor_source_url_unique 
    ON listings (vendor_id, source_url) 
    WHERE source_url IS NOT NULL;
  ```

**1.2 Inventory Records Not Automatically Updated**
- **Risk**: `inventory_records` table is a materialized aggregate with no triggers/constraints ensuring consistency with `listings` table
- **Impact**: Stale aggregated data (counts, prices, availability) leading to incorrect search results
- **Location**: `inventoryRecords.ts`
- **Mitigation**: 
  - Add database triggers to update on listing INSERT/UPDATE/DELETE
  - Or implement application-level eventual consistency with background jobs
  - Add `lastUpdatedAt` validation to detect staleness

**1.3 No Transaction Boundaries for Multi-Table Operations**
- **Risk**: Creating a listing + updating inventory_record in separate transactions can leave inconsistent state
- **Impact**: Partial writes, orphaned records, incorrect aggregates
- **Location**: Application layer (not in schema, but schema doesn't enforce)
- **Mitigation**: Application must use transactions for:
  - Listing creation → inventory_record update
  - Part creation → part_identifier creation
  - Fitment creation → part_fitment creation

**1.4 Real Type Precision Loss**
- **Risk**: `real` type (32-bit float) used for prices, weights, scores can lose precision
- **Impact**: Price rounding errors, incorrect calculations, especially for large numbers
- **Location**: `listings.priceMinorMin/Max`, `parts.weightGrams`, `vendors.reliabilityScore`, `interchangeMemberships.confidence`
- **Mitigation**: Use `numeric` or `integer` (for minor units) instead of `real`

**1.5 JSONB Schema Drift**
- **Risk**: `rawPayloads.payload`, `parts.dimensions`, `fitments.trims/constraints` have no schema validation at DB level
- **Impact**: Malformed JSON can be stored, causing application crashes on read
- **Location**: Multiple tables
- **Mitigation**: Add JSONB check constraints or application-level validation before write

### High

**1.6 Missing `updatedAt` Trigger**
- **Risk**: `updatedAt` columns have no automatic update trigger
- **Impact**: Stale timestamps, incorrect "last modified" queries
- **Location**: All tables with `updatedAt`
- **Mitigation**: Add PostgreSQL trigger:
  ```sql
  CREATE TRIGGER update_updated_at BEFORE UPDATE ON table_name
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  ```

**1.7 Currency Mismatch in Inventory Records**
- **Risk**: `inventory_records.currency` is optional but `lowestPriceMinor/highestPriceMinor` can exist without currency
- **Impact**: Price comparisons across different currencies, incorrect aggregations
- **Location**: `inventoryRecords.ts`
- **Mitigation**: Add check constraint: `currency IS NOT NULL OR (lowestPriceMinor IS NULL AND highestPriceMinor IS NULL)`

## 2. Silent Failure Risks

### Critical

**2.1 Raw Payload Hash Collisions**
- **Risk**: SHA-256 hash uniqueness constraint can silently reject valid payloads if hash collision occurs (extremely rare but possible)
- **Impact**: Valid vendor data lost, no error logged if application doesn't check constraint violations
- **Location**: `rawPayloads.ts` line 19
- **Mitigation**: 
  - Log constraint violations as warnings
  - Add `ingestionId` or timestamp to hash to make collisions impossible
  - Use composite unique: `(payloadHash, ingestionTimestamp)`

**2.2 Foreign Key Violations Swallowed**
- **Risk**: If `warehouseLocationId` references non-existent location, insert fails silently if application doesn't check
- **Impact**: Listing creation fails without clear error message
- **Location**: `listings.ts` line 26-27
- **Mitigation**: Application must validate FK existence before insert, or use database-level error handling

**2.3 Partial Unique Index Gaps**
- **Risk**: If both `vendorListingExternalId` and `sourceUrl` are NULL, no unique constraint applies
- **Impact**: Unlimited duplicate listings with NULL identifiers
- **Location**: `listings.ts`
- **Mitigation**: Add NOT NULL constraint on at least one field, or composite unique on `(vendorId, partId, condition)` as fallback

**2.4 Inventory Record Staleness Undetected**
- **Risk**: `inventory_records.lastUpdatedAt` can be stale with no validation
- **Impact**: Search returns outdated availability/pricing
- **Location**: `inventoryRecords.ts`
- **Mitigation**: Add application-level staleness check, or use materialized view with refresh policy

### High

**2.5 Enum Value Mismatches**
- **Risk**: Application sends enum value not in PostgreSQL enum, fails silently if not caught
- **Impact**: Insert/update fails with cryptic error
- **Location**: All enum columns
- **Mitigation**: Zod validation before DB write, but also add database-level enum validation

**2.6 Check Constraint Violations Not Logged**
- **Risk**: Price/quantity/confidence check constraints fail without application awareness
- **Impact**: Data rejected without audit trail
- **Location**: Multiple tables
- **Mitigation**: Application must catch and log constraint violations

## 3. Race Conditions

### Critical

**3.1 Listing Upsert Race Condition**
- **Risk**: Concurrent ingestion of same listing (same `vendorListingExternalId`) can cause:
  - Duplicate inserts if unique constraint not yet applied
  - Lost updates if using INSERT ... ON CONFLICT without proper locking
- **Impact**: Duplicate listings or stale data overwriting fresh data
- **Location**: `listings.ts`
- **Mitigation**: 
  - Use `INSERT ... ON CONFLICT (vendor_id, vendor_listing_external_id) DO UPDATE`
  - Add `SELECT FOR UPDATE` in transaction before upsert
  - Use application-level distributed lock per `(vendorId, vendorListingExternalId)`

**3.2 Inventory Record Update Race Condition**
- **Risk**: Multiple concurrent listing updates for same `(vendorId, partId)` can cause:
  - Lost updates when recalculating aggregates
  - Incorrect counts if updates happen simultaneously
- **Impact**: Wrong inventory statistics, incorrect search results
- **Location**: `inventoryRecords.ts`
- **Mitigation**:
  - Use `UPDATE inventory_records SET ... WHERE vendor_id = ? AND part_id = ?` with row-level locking
  - Or use PostgreSQL `SELECT FOR UPDATE` in transaction
  - Or use atomic operations: `UPDATE ... SET total_listings_count = total_listings_count + 1`

**3.3 Part Identifier Creation Race**
- **Risk**: Concurrent creation of same `(partId, type, value, manufacturer)` can cause duplicate key errors
- **Impact**: One insert fails, but no clear error handling
- **Location**: `partIdentifiers.ts`
- **Mitigation**: Use `INSERT ... ON CONFLICT DO NOTHING` or application-level deduplication

**3.4 Raw Payload Deduplication Race**
- **Risk**: Concurrent ingestion of same payload (same hash) can cause:
  - Both transactions read "hash doesn't exist"
  - Both try to insert, one fails on unique constraint
  - Failed transaction has no way to know payload was already processed
- **Impact**: Retry loops, duplicate processing attempts
- **Location**: `rawPayloads.ts`
- **Mitigation**: Use `INSERT ... ON CONFLICT (payload_hash) DO NOTHING RETURNING id` to detect duplicates

### High

**3.5 Fitment Creation Race**
- **Risk**: Same fitment created concurrently, leading to duplicate fitments with different UUIDs
- **Impact**: Duplicate fitment records, incorrect part-fitment mappings
- **Location**: `fitments.ts`
- **Mitigation**: Add unique constraint on `(make, model, yearFrom, yearTo)` or use application-level deduplication

**3.6 Interchange Creation Race**
- **Risk**: Same `(system, code)` created concurrently, unique constraint prevents one but no error handling
- **Impact**: Silent failure, lost interchange data
- **Location**: `interchanges.ts`
- **Mitigation**: Use `INSERT ... ON CONFLICT DO NOTHING RETURNING id` to get existing record

## 4. Retry Storms

### Critical

**4.1 Raw Payload Processing Retry Storm**
- **Risk**: If payload processing fails, retry logic can create:
  - Multiple `raw_payloads` entries with same hash (blocked by unique, but retries continue)
  - Multiple processing attempts for same payload
  - Database connection exhaustion
- **Impact**: Cascading failures, database overload, vendor API rate limiting
- **Location**: `rawPayloads.ts`
- **Mitigation**:
  - Use exponential backoff with jitter
  - Implement circuit breaker per vendor
  - Add `processingStartedAt` timestamp to detect stuck processing
  - Use distributed lock (Redis) per `payloadHash` during processing

**4.2 Listing Ingestion Retry Storm**
- **Risk**: Vendor API returns 500, retries create:
  - Multiple ingestion workers processing same vendor
  - Duplicate listing creation attempts
  - Inventory record update conflicts
- **Impact**: Database contention, incorrect inventory counts
- **Location**: `listings.ts`, `inventoryRecords.ts`
- **Mitigation**:
  - Vendor-level rate limiting
  - Per-vendor ingestion lock
  - Idempotent upsert operations
  - Retry with exponential backoff + jitter

**4.3 Inventory Record Recalculation Storm**
- **Risk**: If background job recalculates `inventory_records` and fails, retries can:
  - Lock all inventory records simultaneously
  - Block listing creation
  - Cause deadlocks
- **Impact**: System-wide slowdown, transaction timeouts
- **Location**: `inventoryRecords.ts`
- **Mitigation**:
  - Batch updates with row-level locking
  - Process in smaller chunks
  - Use `SKIP LOCKED` for concurrent processing
  - Separate read/write paths

### High

**4.4 Part Creation Retry Storm**
- **Risk**: Part creation with identifiers/fitments fails mid-transaction, retries create duplicates
- **Impact**: Orphaned records, duplicate parts
- **Location**: `parts.ts`, `partIdentifiers.ts`, `partFitments.ts`
- **Mitigation**: Use transactions with proper rollback, idempotent part creation

## 5. Idempotency Violations

### Critical

**5.1 Listing Upsert Not Idempotent**
- **Risk**: Retrying listing creation without `ON CONFLICT` causes duplicates
- **Impact**: Duplicate listings, incorrect inventory counts
- **Location**: `listings.ts`
- **Mitigation**: 
  - Use `INSERT ... ON CONFLICT (vendor_id, vendor_listing_external_id) DO UPDATE SET ...`
  - Or `INSERT ... ON CONFLICT (vendor_id, source_url) DO UPDATE SET ...`
  - Application must handle both conflict paths

**5.2 Inventory Record Update Not Idempotent**
- **Risk**: Recalculating inventory from listings multiple times can cause:
  - Double-counting if not using `REPLACE` semantics
  - Lost updates if using `+=` operations
- **Impact**: Incorrect aggregates
- **Location**: `inventoryRecords.ts`
- **Mitigation**: Use idempotent calculation: `UPDATE ... SET total_listings_count = (SELECT COUNT(*) FROM listings WHERE ...)`

**5.3 Raw Payload Processing Not Idempotent**
- **Risk**: Processing same payload multiple times can:
  - Create duplicate listings
  - Update inventory records multiple times
  - Send duplicate notifications
- **Impact**: Data duplication, incorrect state
- **Location**: `rawPayloads.ts` → application processing
- **Mitigation**:
  - Mark payload as `PROCESSING` before processing
  - Use `UPDATE raw_payloads SET status = 'PROCESSING' WHERE id = ? AND status = 'PENDING'` (atomic)
  - Only process if update affects 1 row

**5.4 Part Identifier Addition Not Idempotent**
- **Risk**: Adding same identifier multiple times fails on unique constraint
- **Impact**: Retry failures, unclear error handling
- **Location**: `partIdentifiers.ts`
- **Mitigation**: Use `INSERT ... ON CONFLICT DO NOTHING`

**5.5 Fitment Addition Not Idempotent**
- **Risk**: Adding same part-fitment mapping multiple times fails
- **Impact**: Retry failures
- **Location**: `partFitments.ts`
- **Mitigation**: Use `INSERT ... ON CONFLICT DO NOTHING`

### High

**5.6 Interchange Membership Not Idempotent**
- **Risk**: Adding same membership multiple times fails
- **Impact**: Retry failures
- **Location**: `interchangeMemberships.ts`
- **Mitigation**: Use `INSERT ... ON CONFLICT DO NOTHING`

**5.7 Vendor Warehouse Location Not Idempotent**
- **Risk**: Adding same vendor-location mapping multiple times fails
- **Impact**: Retry failures
- **Location**: `vendorWarehouseLocations.ts`
- **Mitigation**: Use `INSERT ... ON CONFLICT DO NOTHING`

## Recommended Immediate Actions

### Priority 1 (Critical - Fix Before Production)
1. Create partial unique indexes on `listings` table
2. Add `updatedAt` triggers to all tables
3. Change `real` to `numeric` or `integer` for financial data
4. Implement idempotent upsert operations for all critical paths
5. Add row-level locking for `inventory_records` updates

### Priority 2 (High - Fix in First Sprint)
1. Add database triggers for `inventory_records` consistency
2. Implement distributed locking for raw payload processing
3. Add retry logic with exponential backoff + jitter
4. Add application-level transaction boundaries
5. Implement circuit breakers per vendor

### Priority 3 (Medium - Monitor and Fix)
1. Add JSONB schema validation
2. Add currency consistency checks
3. Implement staleness detection for inventory records
4. Add comprehensive error logging for constraint violations
5. Add monitoring/alerting for retry patterns
