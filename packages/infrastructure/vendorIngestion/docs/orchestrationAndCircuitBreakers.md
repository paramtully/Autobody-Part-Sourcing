# Orchestration, Single-Writer Model & Circuit Breakers

## Single-Writer per Vendor

- **Goal**: Ensure only one ingestion job per `vendorId` is active at any time.
- **Options**:
  - Vendor-level queue with concurrency=1 per `vendorId`.
  - Distributed lock keyed by `vendorId` (e.g., Postgres advisory lock, Redis lock).

### Recommended Pattern

1. **Job Acquisition**
   - Before starting ingest, attempt to acquire a lock on `vendorId`.
   - If lock acquisition fails, skip the run (or treat as soft failure) to avoid concurrent writers.

2. **Lock Lifetime**
   - Lock is held for duration of ingest.
   - On worker crash, use TTL or advisory lock semantics to release.

## Circuit Breakers per Vendor

- **Goal**: Avoid retry storms and pointless polling of a failing vendor.

### Signals

- Consecutive ingest failures for a vendor.
- Health check status: `down` or persistently `degraded`.

### Behavior

- After N consecutive failures:
  - Mark vendor as "circuit open" in an ops store (e.g., DB, config service).
  - Skip scheduled ingests until a cool-down period has passed or manual reset occurs.

## Global Retry/Backoff Policy

- **Client-level retries** (per HTTP call):
  - Max attempts: small (e.g., 3–5).
  - Base delay: e.g., 200–500 ms.
  - Backoff: exponential (`delay * 2^attempt`).
  - Jitter: add ±20–30% randomization.

- **Job-level retries** (per ingest run):
  - If a run fails early, optionally retry once after a delay.
  - Further retries handled by circuit breaker logic and scheduler.

## Scheduler-Level Backoff

- When a vendor is failing repeatedly:
  - Increase scheduled interval for that vendor:
    - 30m → 1h → 4h → 24h.
  - Reset interval after a successful ingest.

## Implementation Boundaries

- These behaviors live in **scheduler/worker orchestration**, not inside the ingestion pipeline functions.
- The pipeline should:
  - Surface clear success/failure status and error categories.
  - Remain deterministic and side-effect free beyond repository calls.
