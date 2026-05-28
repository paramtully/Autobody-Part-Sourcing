# LKQ Inventory API Client

## Base URL

```
https://api.lkqcorp.com/v1/inventory
```

Override via `LKQ_BASE_URL` env var.

## Authentication

Every request requires three headers:

| Header | Value |
|---|---|
| `X-Api-Key` | API key (`LKQ_API_KEY`) |
| `X-Timestamp` | `Date.now()` as string |
| `X-Signature` | HMAC-SHA256(`LKQ_API_SECRET`, timestamp + queryString) |

## Endpoints

### `GET /listings`

Paginated bulk inventory fetch. This is the only endpoint currently used.

| Param | Type | Description |
|---|---|---|
| `cursor` | string | Opaque cursor for next page (from previous response) |
| `limit` | number | Records per page (default/max: 500) |

**Response:**

```json
{
  "listings": [ ... ],
  "nextCursor": "opaque-base64-string",
  "hasMore": true
}
```

### `fetchByPartNumbers` — Not implemented

The `VendorClient` interface defines an optional `fetchByPartNumbers(partNumbers: string[])` method. It is **not implemented** for LKQ. It's unknown whether the LKQ API supports part-number filtering on `/listings`.

## Rate Limiting

- ~200 requests/minute.
- Returns `429` with a `Retry-After` header (seconds) when exceeded.

## Error Responses

| Status | Classification | Retryable |
|---|---|---|
| 400 | `INVALID_REQUEST` | No |
| 401 / 403 | `AUTH_ERROR` | No |
| 429 | `RATE_LIMIT` | Yes (honor `Retry-After`) |
| 5xx | `SERVER_ERROR` | Yes |

## Key Behaviors

- **Empty listings are not errors.** A `200 OK` with `listings: []` means the parts are discontinued/sold — not a failure.
- **No explicit deactivation.** Listings silently disappear when a part is sold or pulled.
- **Schema is permissive.** `.passthrough()` is used so new fields from LKQ don't break validation.
- **Identity requirement.** Each listing must have at least one of: `id`, `stockNumber`, `url`, or `sourceUrl`.

## Listing Record Fields

| Field | Type | Notes |
|---|---|---|
| `id` | string? | LKQ internal ID |
| `stockNumber` | string? | LKQ stock number |
| `partNumber` | string? | Part number |
| `oemPartNumber` | string? | OEM part number |
| `hollanderNumber` | string? | Hollander interchange code |
| `condition` | string? | Condition text |
| `partGrade` | string? | Quality grade: A, B, C, REMAN |
| `description` | string? | Part description |
| `price` | number? | Unit price |
| `priceMin` / `priceMax` | number? | Price range |
| `currency` | string? | Currency code |
| `quantity` | number? | Available quantity |
| `availability` | string? | e.g. IN_STOCK, BACK_ORDER |
| `make` / `model` / `year` / `trim` | mixed | Vehicle fitment |
| `vehicleVin` | string? | Source vehicle VIN (max 17 chars) |
| `mileage` | number? | Vehicle mileage at salvage |
| `damageType` | string? | e.g. FRONT, REAR, FLOOD |
| `state` / `city` | string? | Yard location |
| `estimatedShipTimeHours` | number? | Shipping estimate |
| `images` | array? | `[{ url, type? }]` |
| `url` / `sourceUrl` | string? | Listing URLs |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LKQ_API_KEY` | Yes | API key for `X-Api-Key` header |
| `LKQ_API_SECRET` | Yes | Secret for HMAC-SHA256 signing |
| `LKQ_BASE_URL` | No | Override base URL (defaults to production) |
