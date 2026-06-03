# Boneyard

**Multi-vendor collision parts search** — VIN/fitment, part number, filters, side-by-side compare. Built and deployed end-to-end.

| | |
|---|---|
| **Live** | [getboneyard.com](https://getboneyard.com) |
| **Stack** | TypeScript · Next.js · Express · Postgres · AWS Lambda · Vercel · Terraform |
| **Shipped with tests** | **160+** automated tests (PGlite in CI, no hosted DB for unit runs) · live smoke on `main` · OIDC deploy, no long-lived AWS keys |

<!-- Add: your name · email · LinkedIn · 1–2 screenshots -->

---

## What I built

Scheduled workers ingest supplier catalogs into **one normalized database**; the app searches across vendors in a single UI.

- **Vendor plugin model** — `VendorInventoryClient` + shared pipeline; eBay US/CA live, LKQ stubbed. New vendor ≈ mapper + config, not a second worker codebase.
- **Resumable ingestion** — Paged catalogs, cursor checkpointing, one concurrent Lambda per vendor (12 min budget).
- **Search/compare in prod** — Fitment wizard, VIN decode, filters, compare tray ([`apps/client/`](apps/client/)).

---

## Production deployment

```mermaid
flowchart TB
  Shop[Shops] --> WEB[Next.js · getboneyard.com]
  WEB --> API[Express API · api.getboneyard.com]
  API --> PG[(Postgres)]

  EB[EventBridge] --> LWUS[listing-worker-ebay-us]
  EB --> LWCA[listing-worker-ebay-ca]
  LWUS --> PG
  LWCA --> PG
  LWUS --> eBay[eBay APIs]
  LWCA --> eBay

  GHA[GitHub Actions] -->|OIDC| AWS[AWS Lambda + IAM]
  GHA -->|after CI| VER[Vercel client + API]

  API -.->|checkout routes off| Stripe[Stripe]
```

| Piece | Where |
|-------|--------|
| Client + API | Vercel (`apps/client`, `apps/api`) |
| Database | Postgres (Supabase pooler in prod) |
| Catalog sync | One Lambda per vendor, EventBridge schedule, shared worker code |
| Deploy | CI on every PR; deploy on `main` after CI · path filters skip unchanged packages · [BOOTSTRAP.md](./BOOTSTRAP.md) |

---

## Data model & ingestion

**Problem:** One physical part can have an OEM number, aftermarket SKU, and interchange ID — formatted differently per vendor (`1234-AB` vs `1234AB`). Shops should search once and see **all equivalent listings**.

```mermaid
erDiagram
  parts ||--o{ part_identifiers : "many IDs per part"
  parts ||--o{ part_fitments : ""
  fitments ||--o{ part_fitments : ""
  part_identifiers ||--o{ listings : "offer at vendor"
  vendors ||--o{ listings : ""
```

| Table | Purpose |
|-------|---------|
| `parts` | Canonical part (name + category) |
| `part_identifiers` | OEM / aftermarket / interchange — normalized for lookup |
| `fitments` + `part_fitments` | Vehicle fit |
| `listings` | Vendor price, condition, stock, URL for a specific identifier |

**Ingestion (`DrizzleRecordProcessor`):** normalize → **2 bulk reads** per 200-listing page → classify in memory (new / update / conflict) → **1 transaction** with batched fitments + `part_fitments` → optional fitment enrichment **only for new parts**.

> **~140× fewer DB round-trips per page** — naïve row-by-row ingest ≈ **3,500** SQL ops vs **~25** with batching (typical 200-listing page). Fitment-heavy paths go from **tens of thousands** of serial INSERTs to **a handful** of chunked statements — the difference between **timing out** a 12 min Lambda and **finishing** a catalog page.

Tests lock this in: idempotent re-ingest, conflict detection when IDs map to two parts, and **graph-integrity checks** so ingestion cannot leave orphan rows ([`recordProcessor.test.ts`](src/vendors/recordProcessor/recordProcessor.test.ts)).

Code: [`src/db/models/`](src/db/models/) · [`src/vendors/recordProcessor/recordProcessor.ts`](src/vendors/recordProcessor/recordProcessor.ts)

---

## Checkout (implemented · not live)

**Status:** Domain code and API routes exist; **`/checkout` and payment webhooks are commented out** in [`apps/api/server.ts`](apps/api/server.ts) until vendor order APIs and Stripe webhooks are production-ready. Search/compare is what ships today.

```mermaid
sequenceDiagram
  participant UI as Client
  participant API as Express
  participant CS as CheckoutService
  participant V as Vendor order API
  participant DB as Postgres
  participant S as Stripe

  UI->>API: POST /checkout/quote
  API->>CS: createQuote
  CS->>V: live item + shipping quote
  CS->>DB: persist checkout_quotes
  UI->>API: POST /checkout/confirm
  API->>CS: confirm (idempotency key)
  CS->>DB: order + outbox event (one transaction)
  CS->>S: PaymentIntent + Tax
  Note over API,S: Routes disabled in prod today
```

- **Quote → confirm** — Vendor-sourced pricing; platform fee computed server-side; amounts read from DB on confirm (no client-supplied totals).
- **Stripe** — `PaymentProviderAdapter` + webhook handler; blocks `EMAIL_MANUAL` vendors (auth-hold window).
- **Reliability** — Idempotent confirm; order + quote delete + **transactional outbox** in one DB transaction; `OutboxPublisher` for async side effects.

Code: [`src/ordering/`](src/ordering/) · [`apps/api/routes/checkout.ts`](apps/api/routes/checkout.ts)

---

## CI/CD

```mermaid
flowchart LR
  PR[PR] --> CI[CI: lint · test · build]
  CI -->|main| CD[Deploy]
  CD --> MIG[Migrations]
  CD --> TF[Terraform]
  CD --> VER[Vercel]
  GH[GitHub OIDC] --> TF
```

- **Search API:** fitment + part-number queries; `DISTINCT ON` so multi-trim joins do not duplicate listings ([`listings.ts`](apps/api/routes/listings.ts)).
- **Deploy:** runs only after CI passes; **path filters** skip unchanged services (client vs API vs workers).

---

## Start here

| Folder | Why open it |
|--------|-------------|
| [`src/vendors/`](src/vendors/) | Plugin interface, pipeline, batch ingest |
| [`apps/api/routes/listings.ts`](apps/api/routes/listings.ts) | Search + pagination |
| [`apps/client/`](apps/client/) | Fitment wizard, results, compare |
| [`src/ordering/`](src/ordering/) | Checkout, Stripe adapter, outbox |

---

## Run locally

Node 20 · `DATABASE_URL` · vendor API keys (eBay today — [BOOTSTRAP.md](./BOOTSTRAP.md))

```bash
npm ci && npm run setup && npm run dev   # client :3000 · API :5050
npm test
```
