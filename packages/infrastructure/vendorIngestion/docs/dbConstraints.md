# DB Constraints & Repository Idempotency

## Listings

- **Table**: `listings`
- **Logical identity**: `(vendorId, vendorListingExternalId)` or `(vendorId, sourceUrl)`
- **Implementation**:
  - Partial unique index (via migrations):
    - `listings_vendor_external_id_unique` on `(vendor_id, vendor_listing_external_id)` where `vendor_listing_external_id IS NOT NULL`
    - `listings_vendor_source_url_unique` on `(vendor_id, source_url)` where `source_url IS NOT NULL`
- **Repository alignment**:
  - `ListingRepository.upsert` docs already specify idempotency based on those identities.
  - `ListingRepository.bulkUpsert` must use the same conflict targets.

## Fitments

- **Table**: `fitments`
- **Logical identity**: `(make, model, year, constraint, trim, engine)`
- **Implementation**:
  - Unique constraint `fitments_unique` on `(make, model, year, constraint, trim, engine)`
- **Junction table**: `part_fitments`
  - Primary key `(partId, fitmentId)` prevents duplicate links for same part+fitment.

## Interchanges

- **Table**: `interchanges`
- **Logical identity**: `(system, code)`
- **Implementation**:
  - Unique constraint `interchanges_system_code_unique` on `(system, code)`
- **Junction table**: `interchange_memberships`
  - Primary key `(partId, interchangeId)` prevents duplicate memberships.

## Warehouse Locations

- **Tables**:
  - `warehouse_locations` (location rows)
  - `vendor_warehouse_locations` (vendor-location links)
- **Logical identity**:
  - Location: currently defined by `(country, stateOrProvince, city, postalCode)` at the application level.
  - Link: `(vendorId, warehouseLocationId)`
- **Implementation**:
  - PK `vendor_warehouse_locations.vendorId, warehouseLocationId` prevents duplicate links.
  - `warehouse_locations` does not yet enforce uniqueness on the country/state/city/postalCode combination; idempotency is enforced at repository level.

## Alignment Summary

- The current schema already enforces uniqueness for:
  - Listings (via partial unique indexes in migrations)
  - Fitments and part-fitment links
  - Interchanges and memberships
  - Vendor-warehouse links
- For warehouse location *rows* themselves, uniqueness is enforced by repository logic rather than a DB constraint.

## Next Steps (if needed later)

- Consider adding a unique index on `warehouse_locations` for `(country, stateOrProvince, city, postalCode)` if you want hard DB guarantees for deduplication.
- Add repository tests (DB-backed) that:
  - Insert duplicates for each logical entity and assert only one row exists.
  - Re-run `bulkUpsert` with identical listings and assert row counts remain stable.
