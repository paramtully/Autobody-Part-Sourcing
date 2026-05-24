# eBay Data Quality Investigation

**Date:** 2026-05-23  
**Evidence base:** 15 live eBay Browse API + Trading API samples (5 queries × 3 items: bumper cover, headlight assembly, fender, door mirror, quarter panel), Supabase DB audit (95 parts / 127 listings / 140 identifiers), and 7 specific skipped-item lookups from the ingest log.

---

## Summary Table

| Issue | Parser site | Observed behavior | Root cause | Severity | Recommended fix |
|---|---|---|---|---|---|
| MPN stored as multi-value blob | `vendorClient.ebay.ts:135` | Comma- or space-separated part numbers stored as one identifier string | `addId(mpnType, mpn, ...)` is not split; only Partslink/OE cross-refs use `splitAspect` | **High** — defeats DB deduplication | Apply `splitAspect` to MPN; filter junk identifier values |
| Manufacturer wrong / missing | `vendorClient.ebay.ts:117-140` | Junk brands ("Aftermarket", seller usernames) stored as manufacturer; real OEM brands missing from whitelist | `JUNK_BRANDS` too small; `AUTOMAKER_BRANDS` missing Mercedes-Benz, Lincoln, Ram, etc. | **Medium** — low data quality, not blocking | Expand `JUNK_BRANDS`; expand `AUTOMAKER_BRANDS` |
| Position never populated | `vendorClient.ebay.ts:165`, `schema.ebay.item.ts:309` | `parts.position` is NULL for virtually all ingested listings | `placement.includes(',')` guard returns `undefined` for compound single-position values like `"Front, Lower"` and `"Rear, Left"` | **High** — position data entirely lost | Only bail on ambiguous placements (both left+right OR both front+rear simultaneously) |
| Postal code masked | `vendorClient.ebay.ts:184-186` | `warehouse_locations.postal_code` stores `"917**"` instead of a real zip | eBay privacy policy masks the last 2 digits of all seller postal codes | **Low** — expected eBay behavior, not a parser bug | Accept masked values; strip `**` suffix or document as approximate |
| Junk identifiers causing conflicts | `recordProcessor.ts:344` | ~15-18% of records skipped as "identifiers resolve to 2-3 parts" in later pages | Sellers put product descriptions, "NA", or "N/A" in identifier fields; no filter on identifier values before ingestion | **High** — causes false conflict rate, bloats conflict skip count | Filter junk identifier values before calling `addId` |
| Category mapped from `categoryPath` alone; `Type` aspect ignored | `schema.ebay.item.ts:209`, `vendorClient.ebay.ts:158` | Bumper covers ingested as `BUMPER`; quarter panels ingested as `FENDER` | eBay's `Bumpers & Reinforcements` and `Panels|Fenders` categories are too broad; `Type` localizedAspect is never consulted | **High** — wrong category breaks deduplication key and position mapping downstream | Consult `aspects['Type']` as a tiebreaker when `categoryPath` maps to a broad bucket |
| Search query returns mostly generic items | `vendorClient.ebay.ts:60` | DB dominated by `MOLDING` (clips, fasteners, trim kits) rather than structural body panels | `DEFAULT_SEARCH_QUERY = 'auto body part'` pulls eBay's best-match results, which skew generic | **Medium** — not a parsing bug but severely limits data utility | Replace keyword query with targeted eBay sub-category ID enumeration |

---

## 1. Identifier Value — MPN Stored as a Multi-Value Blob

### Evidence

All 15 targeted samples showed `product.aspects = {}` (empty). All identifier data comes exclusively from `localizedAspects`. The `item.mpn` top-level field was `undefined` for all 15 samples — it is never populated.

Current code reads:
```typescript
const mpn = aspects['Manufacturer Part Number']?.[0] ?? item.mpn;
// ...
addId(mpnType, mpn, brand ?? undefined, certification);
```

`buildAspectMap` stores `localizedAspects` as `map[name] = [value]` — a single-element array containing the full raw string. When a seller puts multiple part numbers in the MPN field, the entire comma-separated string is stored as one identifier value.

**Real data observed:**

| Item | MPN field value (raw) | What should be stored |
|---|---|---|
| `v1|277644944264|0` Nissan Altima bumper | `"NI1039163, NI1000323, NI1200292, NI1038163"` | 4 separate INTERCHANGE identifiers |
| `v1|235556756966|0` Nissan Altima headlight | `"260603TA0A 260103TA0A"` (space-sep) | 2 separate OEM identifiers |
| `v1|196417496746|0` Kia Optima headlight | `"92101D5000, KI2502196"` | 2 identifiers (one OEM, one aftermarket) |
| `v1|373577053317|0` door mirror | `"55027207,55027208,5132665"` (no-space comma) | 3 separate identifiers |
| `v1|234531205531|0` Ford Taurus headlight | `"13453832"` (single, works correctly) | 1 identifier ✓ |

The OE cross-ref fields (`OE/OEM Part Number`, `OE Number`) have the same problem. The `Honda Civic quarter panel v1|186848094548|0` has:
```
OE/OEM Part Number: "04646TBAA01ZZ, 04646-TBA-A01ZZ, 04646-TXM-A90ZZ, 04646TXMA90ZZ"
```
`splitAspect` IS already applied here for OE cross-refs, so these 4 values ARE split correctly. But the MPN path skips `splitAspect` entirely.

Additionally, the `Interchange Part Number` aspect key is **never read** by the parser. Several items use it as the primary cross-reference slot:

| Item | Interchange Part Number value |
|---|---|
| `v1|277644944264|0` | 17 values including all OEM, Partslink, and internal numbers |
| `v1|373577053317|0` | `"55027207,55027208,5132665"` (same as MPN) |
| `v1|234531205531|0` | `"8G1Z13008F,FO2502238,8G1Z13008E,FO2503238,..."` (with extra metadata jammed in) |

### Impact

A Nissan Altima bumper with MPN `"NI1039163, NI1000323, NI1200292, NI1038163"` stored as a single blob will:
- Never match any existing `part_identifiers` row on future ingestion (the 4-part string is unique)
- Be treated as a new part every run (identifier is unique even if the physical part is the same)
- Defeat cross-vendor deduplication entirely

---

## 2. Manufacturer — Junk and Missing Brands

### Evidence

`v1|196417496746|0` (Kia Optima headlight):
```json
"brand": "Aftermarket",
"localizedAspects": [{ "name": "Brand", "value": "Aftermarket" }, ...]
```
`cleanBrand('Aftermarket', ...)` returns `'Aftermarket'` (not in `JUNK_BRANDS`), so `manufacturer: 'Aftermarket'` is stored on an identifier for a real Kia OEM number (`92101D5000`).

`v1|277644944264|0` (Nissan Altima bumper):
- `brand = 'Texas-E-Parts'` (a dropshipper)
- MPN type classified as `INTERCHANGE` because `Texas-E-Parts` is not in any brand set
- `manufacturer: 'Texas-E-Parts'` stored on identifiers that represent Nissan OEM numbers

`v1|397917015223|0` (Mercedes Sprinter fender):
- `brand = 'Mercedes-Benz'`
- `Mercedes-Benz` is **not in `AUTOMAKER_BRANDS`**
- MPN `MB1240156` gets classified as `INTERCHANGE` with `manufacturer: 'Mercedes-Benz'` instead of `OEM`

Current `AUTOMAKER_BRANDS` is missing: `Mercedes-Benz`, `Lincoln`, `Ram`, `Scion`, `Tesla`, `Genesis`, `Alfa Romeo`, `FIAT`, `Volvo` (moved to this category from its current position — Volvo is listed as an automaker but produces OEM parts).

Brands that appear in production that are not in any list:
- `Aftermarket` (junk — should be in `JUNK_BRANDS`)
- `Texas-E-Parts`, `Autohai`, `Ionfast`, `Autoelements`, `yellowspeed`, `myautopartsstore`, `beamax-9` — all aftermarket/dropshippers that should be treated as INTERCHANGE

### Impact

`manufacturer` column in `part_identifiers` is either missing meaningful values or contains junk values. The `type` column misclassifies real OEM identifiers as INTERCHANGE.

---

## 3. Position — Comma Guard Is Too Aggressive

### Evidence

`mapEbayPosition` in `schema.ebay.item.ts:309`:
```typescript
if (!placement || placement.includes(',')) return undefined;
```

This returns `undefined` for **any** comma in the placement string. However, commas appear in two distinct scenarios:

**Scenario A — Genuinely ambiguous (multi-part or multi-side listings):**
- `"Left, Right"` — a pair of headlights, no single position
- `"Front, Left, Right"` — two front headlights, no single position
- `"Left, Right, Front, Rear, Upper, Lower"` — generic clips kit, no meaningful position

**Scenario B — Compound single position (a single part that occupies a known location):**
- `"Front, Lower"` (Ford F150 bumper `v1|134774613017|0`) — this IS a front bumper, should be `FRONT_BUMPER`
- `"Rear, Left"` (Honda Civic quarter panel `v1|186848094548|0`) — should be `QUARTER_PANEL_LEFT`

The current guard fails Scenario B, returning `undefined` instead of extracting the meaningful position.

**Production impact measured in DB:**  
Of 95 parts in the current DB, the top-parts query shows `position: null` for all non-bumper items. Even `BUMPER_COVER` category items only get position when the placement is a clean single word like `"Front"` or `"Rear"`.

**Frequency of comma placements in 15 targeted samples:**

| Placement value | Has comma | Should have position |
|---|---|---|
| `"Front, Lower"` | yes | yes — `FRONT_BUMPER` |
| `"Front, Left, Right"` | yes | no — pair listing |
| `"Left, Right"` | yes | no — pair listing |
| `"Front, Left, Rear, Right"` | yes | no — 4-piece kit |
| `"LH, L, Driver, Front, Left, Right"` | yes | no — multi-vehicle |
| `"Left, Right, Front, Rear, Upper, Lower"` | yes | no — universal |
| `"Rear, Left"` | yes | yes — `QUARTER_PANEL_LEFT` |
| `"Front"` | no | yes — works ✓ |
| `"Front RH"` | no | yes — works ✓ |
| `"Right"` | no | yes — works ✓ |

10 out of 15 samples had commas in the placement field.

---

## 4. Postal Code — eBay Privacy Masking

### Evidence

eBay masks the last 2 digits of all seller postal codes. Every item with a postal code showed this pattern:

| City | Raw postalCode |
|---|---|
| Ontario, CA | `917**` |
| Hayward, CA | `945**` |
| Santa Clara area | `956**` |
| La Salle, IL | `613**` |
| West Carrollton, OH | `454**` |
| Dayton, NJ | `088**` |
| Richmond, CA | `948**` |
| Kennesaw, GA | `301**` |
| Upland, CA | `917**` |
| Brooklyn, NY | `112**` |

Some items omit `postalCode` entirely: `v1|277644944264|0` (Sugar Land, TX) has `{ "city": "Sugar Land", "country": "US" }` — no postal code field at all.

One item shows obviously invalid location data: `v1|188412373611|0` has `"city": "CA / KY/NJ", "stateOrProvince": "United States"` — a multi-state dropshipper entry.

### Classification

This is **not a parser bug** — the code correctly reads `item.itemLocation.postalCode` verbatim. The masking is eBay's privacy policy. The data in the DB accurately reflects what eBay provides.

However, storing `917**` as a postal code can cause issues if the warehouse location lookup ever tries to geocode or validate postal codes. The `getOrCreateWarehouseLocation` function stores masked codes as-is with no indication they are approximate.

---

## 5. Conflict Root Cause — Junk Identifiers

### Evidence: DB audit of all conflict rows

The DB contains exactly **3 conflicting identifier values**, all from junk data:

| Identifier value | Type | Parts it maps to | Root cause |
|---|---|---|---|
| `"100 Pcs Automotive Push Type Retainer Kit"` | INTERCHANGE | 3 parts (different name/category) | Seller used product description as MPN |
| `"415 Pcs Push Retainer Kit"` | INTERCHANGE | 2 parts | Seller used product description as MPN |
| `"NA"` | OEM | 2 parts | Seller used "NA" for "not applicable" |

There are also single-instance junk values in the DB: `"NO"` (OEM), `"Unbranded"` (INTERCHANGE).

### Evidence: Direct lookup of all 7 skipped items from the ingest log

| Skipped item | MPN aspect value | Interchange aspect value | Classification |
|---|---|---|---|
| `v1|188412373611|0` | `"100 Pcs Automotive Push Type Retainer Kit"` | `"Screw Fender Body Door Trim Panel Hood"` | **Junk identifier** |
| `v1|188412350721|0` | `"100 Pcs Automotive Push Type Retainer Kit"` | `"Screw Fender Body Door Trim Panel Hood"` | **Junk identifier** |
| `v1|188412357232|0` | `"100 Pcs Automotive Push Type Retainer Kit"` | `"Screw Fender Body Door Trim Panel Hood"` | **Junk identifier** |
| `v1|404738270848|0` | `"100 Pcs Automotive Push Type Retainer Kit"` | `"Screw Fender Body Door Trim Panel Hood"` | **Junk identifier** |
| `v1|317431311618|0` | `"415 Pcs Push Retainer Kit"` | `"Universal For Auto Car SUV Off-Road Pickup Truck"` | **Junk identifier** |
| `v1|317431311591|0` | `"415 Pcs Push Retainer Kit"` | `"Universal For Auto Car SUV Off-Road Pickup Truck"` | **Junk identifier** |
| `v1|188412354145|0` | `"100 Pcs Automotive Push Type Retainer Kit"` | `"Screw Fender Body Door Trim Panel Hood"` | **Junk identifier** |

**All 7 skipped items — 100% — were caused by junk identifiers.** There are no genuine part-number collisions in the current DB. The conflict skip mechanism is working as designed; the problem is that junk values are being accepted as identifiers in the first place, causing legitimate-but-different products to incorrectly map to a shared "part."

### Conflict classification breakdown

| Classification | Count | % |
|---|---|---|
| Junk identifier (product description / "NA" / "NO" used as part number) | 3/3 | 100% |
| Classification drift (same physical part under different name/category) | 0/3 | 0% |
| Genuinely shared cross-ref (same part number applies to multiple distinct parts) | 0/3 | 0% |

This is unambiguous: the "N parts conflict" skip is entirely a **junk-identifier problem**, not a data-model problem.

---

## 6. Category Mapping — `categoryPath` Too Broad, `Type` Aspect Ignored

### Evidence

`mapEbayCategory` in [`src/vendors/clients/ebay/schema.ebay.item.ts:209`](src/vendors/clients/ebay/schema.ebay.item.ts) builds a single text string from `categoryPath + categoryName` and matches it against regex patterns. It never looks at any localizedAspect value. Two eBay category buckets are wide enough to contain multiple distinct part types:

**`Bumpers & Components|Bumpers & Reinforcements`** — eBay places bumper covers, bumper beams, reinforcements, and brackets all in this one leaf category. The `mapEbayCategory` regex `/bumper/` fires before `/bumper\s*(cover|fascia)/` can match (because the text `bumpers & reinforcements` does not contain the word "cover"), so everything in this bucket becomes `BUMPER`.

**`Panels|Fenders`** — eBay groups fenders and quarter panels together. The regex `/fender/` matches, returning `FENDER` for what are actually quarter panels.

**Observed misclassifications across 15 targeted samples:**

| Item | Actual part | `categoryPath` leaf | `mapEbayCategory` result | `Type` aspect | Correct category |
|---|---|---|---|---|---|
| `v1|134774613017|0` | Ford F150 bumper cover | `Bumpers & Components|Bumpers & Reinforcements` | `BUMPER` | `"Bumper Lower Grille Trim Panel"` | `BUMPER_COVER` |
| `v1|277644944264|0` | Nissan Altima bumper cover | `Bumpers & Components|Bumpers & Reinforcements` | `BUMPER` | `"Front Bumper Cover Complete"` | `BUMPER_COVER` |
| `v1|366197952334|0` | Chevy Tahoe bumper cover | `Bumpers & Components|Bumpers & Reinforcements` | `BUMPER` | `"Bumper cover"` | `BUMPER_COVER` |
| `v1|186848094548|0` | Honda Civic quarter panel | `Panels|Fenders` | `FENDER` | `"Quarter Panel"` | `QUARTER_PANEL` |
| `v1|396892028059|0` | Honda Civic quarter panel | `Panels|Fenders` | `FENDER` | (absent) | `QUARTER_PANEL` — detectable from title |

5 out of 15 targeted samples (33%) were misclassified. 3 bumper covers became `BUMPER` and 2 quarter panels became `FENDER`.

### Root cause

`mapEbayCategory` is called at [`vendorClient.ebay.ts:158`](src/vendors/clients/ebay/vendorClient.ebay.ts):
```typescript
const category = mapEbayCategory(item.categoryPath, item.primaryCategory?.categoryName);
```

The `aspects` map (which contains the `Type` localizedAspect) is built just above this call and is available, but it is never passed to `mapEbayCategory`. The `Type` aspect consistently carries the correct fine-grained part type that the seller explicitly entered:

| `Type` aspect value | Correct category |
|---|---|
| `"Bumper cover"`, `"Front Bumper Cover Complete"`, `"Bumper Lower Grille Trim Panel"` | `BUMPER_COVER` |
| `"Quarter Panel"` | `QUARTER_PANEL` |
| `"Fender"`, `"Fender Flares"` | `FENDER` |
| `"Headlight Assembly"` | `HEADLIGHT` |
| `"Towing Mirror Assembly"` | `DOOR_MIRROR` |

### Downstream impact

A wrong category has two cascading effects:
1. **Deduplication breaks** — `parts` has a unique constraint on `(name, category)`. A bumper cover listed as `BUMPER` by one seller and `BUMPER_COVER` by another creates two separate part rows for the same physical part, causing identifier conflicts on subsequent ingestion.
2. **Position mapping breaks** — `mapEbayPosition` is category-aware. A `BUMPER` item with `Placement: "Front"` returns `FRONT_BUMPER`; but a `BUMPER_COVER` item with the same placement would also return `FRONT_BUMPER` — this case works by coincidence. However, if a quarter panel is stored as `FENDER`, `mapEbayPosition` returns `FRONT_LEFT_FENDER` / `FRONT_RIGHT_FENDER` instead of `QUARTER_PANEL_LEFT` / `QUARTER_PANEL_RIGHT`.

---

## 7. Search Query Scope — Why the DB Is Dominated by MOLDING

### Evidence

The ingest worker uses a single search query defined at [`vendorClient.ebay.ts:60`](src/vendors/clients/ebay/vendorClient.ebay.ts):
```typescript
private readonly DEFAULT_SEARCH_QUERY = 'auto body part';
private readonly MOTORS_CATEGORY_ID = '6028';  // eBay Motors → Parts & Accessories
```

Category `6028` is the entire eBay Motors parts tree (~millions of listings). The keyword `'auto body part'` is a broad phrase that eBay's relevance ranking resolves to the top-selling generic items in the category — which are disproportionately clip/fastener/trim kits from high-volume dropshippers.

**DB composition at audit time (95 parts):**

| Category | Count | % | Notes |
|---|---|---|---|
| `MOLDING` | ~75 | ~79% | Clips, fasteners, rubber grommets, trim kits |
| `BUMPER` | ~8 | ~8% | Includes items that should be `BUMPER_COVER` |
| `FENDER` | ~5 | ~5% | Includes items that should be `QUARTER_PANEL` |
| `OTHER` | ~4 | ~4% | Mud flaps, misc accessories |
| Other body panel categories | ~3 | ~3% | |

The targeted samples fetched with specific queries (`bumper cover`, `headlight assembly`, `fender`, `door mirror`, `quarter panel`) show that actual structural body panels do exist on eBay with good identifier/aspect data — the ingest just never reaches them because the generic query ranks them below the clip kits.

### Classification

This is **not a parser bug** — the parser correctly handles whatever listings the search returns. The issue is at the fetch layer: the search query does not target the part types the system is designed to aggregate.

### Impact

Even after all parser fixes are applied, the DB will continue to fill with MOLDING items and miss bumper covers, headlights, fenders, and quarter panels as long as the search query stays as `'auto body part'`.

---

## 8. Extended Index (`_INDEX_extended.md` findings)

This section summarizes observed aspect key names across all 15 targeted samples.

### Aspect keys used for identifiers (observed in real data)

| Aspect key | Parser reads it? | Notes |
|---|---|---|
| `Manufacturer Part Number` | ✅ | Multi-value (comma/space) — not split |
| `Partslink Number` | ✅ | Split correctly via `splitAspect` |
| `Part Link Number` | ✅ | Split correctly via `splitAspect` |
| `OE/OEM Part Number` | ✅ | Split correctly via `splitAspect` |
| `OE Number` | ✅ | Split correctly via `splitAspect` |
| `Interchange Part Number` | ❌ **never read** | Used as primary cross-ref on many items |
| `Superseded Part Number` | ❌ never read | Seen on `v1|373577053317|0`, `v1|234531205531|0` |
| `Other Part Number` | ❌ never read | Seen on `v1|305906941485|0`, `v1|373577053317|0` |

### Aspect keys used for position (observed in real data)

| Aspect key | Parser reads it? | Notes |
|---|---|---|
| `Placement on Vehicle` | ✅ | Present on 13/15 samples |
| `Vehicle Part Location` | ❌ **never read** | Seen on `v1|386265881770|0` (Hyundai Sonata mirror); value: `"Passenger Side"` |

---

## Recommended Follow-Up Fix Plan

The follow-up PR should address the seven issues in this priority order:

### Fix 1 (highest impact): Junk identifier filter in `addId`

Add a `JUNK_IDENTIFIER_VALUES` set and a value-length guard in `addId` (inside `vendorClient.ebay.ts`) so that values like `"NA"`, `"N/A"`, `"does not apply"`, `"none"`, `"universal"`, and values longer than ~50 characters (likely product descriptions) are silently dropped before being passed to the record.

This eliminates 100% of the current conflicts.

### Fix 2 (high impact): Split MPN on comma and space

Apply `splitAspect` (or a similar split) to the MPN field before calling `addId`. The current behavior stores multi-part-number strings as a single blob, defeating deduplication.

For the space-separated case (`"260603TA0A 260103TA0A"`), apply an additional split on whitespace after the comma split (only when no comma is present).

Consider whether to emit each split MPN value with the same type (OEM/AFTERMARKET/INTERCHANGE), or to attempt per-value type inference.

### Fix 3 (high impact): Add `Interchange Part Number` to the identifier pipeline

Read `aspects['Interchange Part Number']` and emit its values as `INTERCHANGE` type (like the current eBay itemId fallback). This is the most commonly populated cross-reference field for aftermarket sellers and currently contributes zero identifiers.

Guard against multi-item junk like `"2009 2008,Ford,Taurus D"` mixed into the interchange field (Evan Fischer headlight `v1|234531205531|0`) — apply a value-length filter and a "looks like a year or brand name" filter.

### Fix 4 (medium impact): Loosen the comma-position guard

In `mapEbayPosition`, replace `placement.includes(',')` with a check that only bails when placement contains BOTH a left/right synonym AND a front/rear synonym simultaneously (indicating a multi-piece kit or pair), OR when it contains more than 2 comma segments. This recovers `"Front, Lower"` → `FRONT_BUMPER` and `"Rear, Left"` → `QUARTER_PANEL_LEFT`.

Also add `Vehicle Part Location` as a fallback aspect key when `Placement on Vehicle` is absent.

### Fix 5 (medium impact): Expand brand lists

Add to `AUTOMAKER_BRANDS`: `Mercedes-Benz`, `Lincoln`, `Ram`, `Scion`, `Tesla`, `Genesis`.  
Add to `JUNK_BRANDS`: `aftermarket`, `aftermarket part`, `oe replacement`, `oe style`.  
Add to `AFTERMARKET_BRANDS`: `Evan Fischer`, `Autoelements`, `Autohai`, `Ionfast` (or auto-detect non-automaker brands as INTERCHANGE rather than trying to maintain this list manually).

A longer-term improvement: drop the hard-coded brand lists entirely and instead derive type from whether the identifier value matches OEM number patterns (Honda OEM numbers like `04711-TBA-A90ZZ` are structurally distinct from Partslink numbers like `HO1000296`).

### Fix 6 (low impact): Document / handle masked postal codes

Either:
- Strip the `**` suffix on write: `postalCode: loc.postalCode?.replace(/\*+$/, '') || undefined` (result: `"917"` — still not useful but at least not misleading)
- Or: set `postalCode: undefined` when the value contains `*`

Add a note in `VendorRecord` typedoc that warehouse postal codes from eBay are approximate (last 2 digits masked).

### Fix 7 (high impact): Use `Type` aspect to refine broad categories

After computing `category` from `mapEbayCategory`, apply a refinement step using `aspects['Type']` when the result is a broad bucket (`BUMPER`, `FENDER`). Run the `Type` value through the same regex patterns used by `mapEbayCategory` (or a dedicated refinement table):

- `BUMPER` + Type contains `cover` or `fascia` → `BUMPER_COVER`
- `BUMPER` + Type contains `beam` → `BUMPER_BEAM`
- `BUMPER` + Type contains `bracket` → `BUMPER_BRACKET`
- `BUMPER` + Type contains `foam` or `absorber` → `BUMPER_FOAM`
- `FENDER` + Type contains `quarter` → `QUARTER_PANEL`
- `FENDER` + Type contains `liner` or `wheel well` → `FENDER_LINER`

This can be implemented as a standalone `refineCategory(category, aspects)` helper called immediately after `mapEbayCategory` in `vendorClient.ebay.ts`. As a further fallback, run the same logic against `item.title` when the `Type` aspect is absent (the quarter panel example `v1|396892028059|0` had no `Type` aspect, but the title contained "Quarter Panel").

### Fix 8 (medium impact): Replace keyword search with sub-category ID enumeration

Replace `DEFAULT_SEARCH_QUERY = 'auto body part'` and the single `MOTORS_CATEGORY_ID = '6028'` with a list of targeted eBay sub-category IDs. Candidate IDs observed in real data:

| Sub-category | eBay category ID (approximate) |
|---|---|
| Bumper covers / Bumpers & Reinforcements | `33637` |
| Fenders / Panels | `33714` |
| Headlight Assemblies | `33710` |
| Side View Mirrors | `33642` |
| Doors | `33556` |
| Hoods | `33567` |
| Quarter Panels / Rocker Panels | `33714` |

The implementation options are:
- Run a separate `fetchInventoryPage` pass per sub-category ID, or
- Use eBay's `filter=categoryIds:{id1|id2|...}` query parameter to target multiple sub-categories in a single search

Either approach ensures that structural body panels fill the DB rather than clip/fastener kits, and makes the search scope deterministic rather than dependent on eBay's keyword ranking.

### Fix 9 (medium impact): Update test fixtures to reflect real eBay data

After completing fixes 1–4, 7, update `test/fixtures/ebay/itemDetail.valid.json` to use real aspect key names and multi-value patterns from `test/fixtures/ebay/live/`. Specifically:
- Add an `Interchange Part Number` aspect to exercise fix 3
- Add a comma-separated MPN to exercise fix 2
- Add a compound placement like `"Front, Lower"` to exercise fix 4
- Add a `Type: "Bumper cover"` aspect under a `Bumpers & Reinforcements` categoryPath to exercise fix 7
- Add a postal code with `**` masking to exercise fix 6

This ensures regressions are caught at the unit-test level rather than only visible in production ingest logs.
