# Ingestion SLOs & Monitoring

## Example SLOs

1. **Vendor Run Success Rate**
   - Target: 95% of scheduled vendor ingestion runs succeed per day.

2. **Data Freshness**
   - Target: 99% of listings for each active vendor are refreshed at least once every 24 hours.

3. **Change Detection Efficiency**
   - Target: For vendors with stable catalogs, at least X% of ingests result in "unchanged" (hash match) to avoid unnecessary writes.

## Key Metrics

Per vendor ingest run:

- `ingest_runs_total{vendorId, outcome="success|failure"}`
- `ingest_listings_processed_total{vendorId}`
- `ingest_listings_succeeded_total{vendorId}`
- `ingest_listings_failed_total{vendorId}`
- `ingest_listings_skipped_total{vendorId}` (unchanged by hash)
- `ingest_duration_seconds{vendorId}`

Freshness:

- `ingest_last_success_timestamp{vendorId}`
- `listing_last_seen_age_bucket{vendorId}` (histogram of ages since `lastSeenAt`)

## Dashboards

Build dashboards that show, per vendor:

- Run success/failure counts and trends.
- Listings processed/succeeded/failed per run.
- Distribution of `lastSeenAt` ages (freshness).
- Ratio of changed vs unchanged listings.

## Alerts

Example alert conditions:

- `ingest_runs_total{vendorId, outcome="failure"}` above threshold in rolling window.
- `ingest_last_success_timestamp{vendorId}` older than SLO (e.g., >24 hours).
- `ingest_listings_failed_total{vendorId}` exceeds threshold percentage per run.

## Implementation Notes

- Metrics should be emitted by the ingestion worker around each pipeline invocation.
- SLOs are enforced via alerting rules in your observability platform.
