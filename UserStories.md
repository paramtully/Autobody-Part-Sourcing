# User Stories

## Core MVP Features
### Core Search Flow
As a collision shop estimator
I want to search parts using VIN or part number
So that I can find available replacements in under 30 seconds
#### Acceptance:
- Returns at least 1 vendor option when available
- Shows price + ETA + vendor source
- Works during vendor outages using cached data
-
---
### Inventory Reliability
As the system
I must ingest vendor inventory continuously
So that shop search results reflect real availability
#### Acceptance:
- Vendor outages don’t stop other vendors
- Raw payload stored before normalization
- Duplicate ingestion does not corrupt inventory
-
---
## Additional MVP Features
### Vendor Transparency
As a shop
I want to see supplier reliability indicators
So that I can choose parts that actually arrive on time
#### Acceptance:
- Shows historical ETA accuracy score
- Shows vendor source type (OEM / aftermarket / salvage)
-
---
### Operational Visibility
As an operator (you)
I want to see vendor ingestion health
So that I can fix outages before customers notice
#### Acceptance:
- Shows ingestion success rate per vendor
- Shows data freshness lag
-
---
## Future Features (Not MVP)
### Ordering:
One-click part ordering
### Financing:
Shop credit for parts

