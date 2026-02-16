# Schema Drift & Field Coverage Monitoring

## Goals

- Detect when vendor contracts change in ways that affect ingestion quality.
- Avoid relying solely on Zod failures (since `.passthrough()` and `.optional()` allow drift).

## Field Coverage Metrics

For each vendor and critical field, track the percentage of listings that have that field present.

### Example Metrics

- `vendor_field_presence{vendorId, field="price"}`
- `vendor_field_presence{vendorId, field="condition"}`
- `vendor_field_presence{vendorId, field="quantityAvailable"}`
- `vendor_field_presence{vendorId, field="isActive"}`

These metrics should be emitted during ingestion runs.

## Schema Drift Alerts

Define thresholds for significant changes in field coverage:

- Example: price presence for a vendor drops from >99% to <80% over N runs.
- Example: `condition` field becomes mostly missing for a vendor that previously always sent it.

Alerts should be configured to notify on:

- Sudden drops in field coverage.
- Persistent low coverage for critical fields.

## Vendor Contract Docs

Maintain a simple per-vendor contract document or JSON config with:

- Required fields (must be present for the listing to be ingestible).
- Expected fields (should be present most of the time; used for alerts if missing).
- Optional fields (best-effort only).

This config can drive both:

- Validation behavior (e.g., when to treat listing as invalid vs degraded).
- Monitoring expectations (which metrics to alert on).

## Implementation Notes

- Metrics and alerts live in your observability stack, not inside the core domain.
- The ingestion pipeline should:
  - Count presence/absence of key fields per vendor per run.
  - Emit those counts/ratios as metrics.
