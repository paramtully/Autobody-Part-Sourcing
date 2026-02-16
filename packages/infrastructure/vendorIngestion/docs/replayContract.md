# Raw Payload Replay Contract

## Current Raw Payload Schema

- **Table**: `raw_payloads`
- **Columns (relevant)**:
  - `id` (UUID, PK)
  - `vendorId` (FK to `vendors`)
  - `payload` (JSONB)
  - `payloadHash` (text, unique)
  - `ingestionTimestamp` (timestamp)
  - `status` (`PENDING | PROCESSED | FAILED`)
  - `processingStartedAt` (timestamp)
  - `errorMessage` (text)

## Replay Semantics

- **Definition**: Replay means **re-running ingestion with current logic** against a stored raw payload.
- **Implications**:
  - Replays may produce different results than the original run if mapping/canonicalization logic has changed.
  - Replays are primarily for audit, debugging, and corrective reprocessing after bugs are fixed.

## Replay API Design (Conceptual)

- **Inputs**:
  - `rawPayloadId` (UUID)
  - `vendorId` (for safety)
  - Optional `dryRun` flag (no writes, just validation + diff report)
- **Behavior**:
  - Fetch payload from `raw_payloads`.
  - Run through current ingestion pipeline (validation → DTO mapping → change detection → upserts).
  - Persist results and emit an `IngestionReplayCompleted` event.

## Safety & Idempotency Considerations

- Because `payloadHash` is unique across `raw_payloads`, identical payloads from a vendor are stored once.
- Replaying the same `rawPayloadId` multiple times is **logically idempotent** if:
  - Repository upserts are correctly implemented.
  - Change detection treats unchanged canonical payloads as no-ops.

## Metadata Extensions (Future)

You may later extend `raw_payloads` with:

- `processedAt` (timestamp): when the payload was last successfully processed.
- `processedByVersion` (text): version string of the ingestion code used.

These fields are currently **not required** for the chosen replay semantics ("re-run with current logic"), but they are useful for:

- Answering: "Has this payload ever been successfully ingested?".
- Understanding how behavior changed across code versions.

## Operational Guidance

- Restrict replay to ops/SRE users.
- Always log replay actions with `rawPayloadId`, initiator, reason, and outcome.
- Consider running large or risky replays in staging first.
