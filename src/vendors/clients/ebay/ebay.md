# eBay Buy APIs (Motors) — Senior Engineer Reference

This document summarizes the relevant technical surface area of the eBay Buy APIs
for accessing Motors inventory (parts & accessories).

Company: eBay  
API Family: Buy REST APIs  
Auth: OAuth 2.0  
Base URL (Prod): https://api.ebay.com  

---

# 1. Conceptual Model

There is no separate "Motors API."

Motors inventory is accessed via the standard Buy APIs:
- Browse API (search & discovery)
- Item API (item details)
- Taxonomy API (categories & aspects)
- Order API (checkout)
- Identity API (OAuth)

Motors-specific behavior is primarily:
- Category-scoped
- Aspect-driven (MPN, brand, fitment)
- Compatibility/fitment metadata in listings

---

# 2. Authentication

Protocol: OAuth 2.0

## 2.1 Application Token (Client Credentials Flow)

Used for:
- Public search
- Item details
- Taxonomy queries

Endpoint:
POST /identity/v1/oauth2/token

Grant:
grant_type=client_credentials

Scope:
https://api.ebay.com/oauth/api_scope

Returns:
- access_token
- expires_in (~7200 seconds)

Token is app-scoped (not user-specific).

---

## 2.2 User Token (Authorization Code Flow)

Required for:
- Order creation
- Checkout session
- Any buyer-specific action

Flow:
1. Redirect user to eBay auth
2. Receive authorization code
3. Exchange for access + refresh token
4. Use user token for Order API

Orders cannot be placed without explicit user authorization.

---

# 3. Core APIs

## 3.1 Browse API (Search)

Primary endpoint:
GET /buy/browse/v1/item_summary/search

Purpose:
- Search live listings
- Filter, sort, paginate

Key query parameters:
- q (keyword search)
- category_ids (strongly recommended)
- filter (price, conditionIds, itemLocationCountry, etc.)
- sort (price, newlyListed, etc.)
- limit (max 200)
- offset (pagination)

Response:
- itemSummaries[]
  - itemId
  - title
  - price
  - condition
  - image
  - seller
  - shipping
  - buyingOptions

Notes:
- Returns summarized data only.
- Use Item API for full detail.

---

## 3.2 Item API (Full Item Details)

Endpoint:
GET /buy/browse/v1/item/{item_id}

Returns:
- Full image array
- Seller details
- Return policy
- Shipping options
- Aspects (brand, MPN, etc.)
- Compatibility data (if provided)

Motors relevance:
- product.aspects
- localizedAspects
- compatibilityProperties (fitment)

Data quality varies by seller.

---

## 3.3 Taxonomy API

Purpose:
- Retrieve category tree
- Discover valid category IDs
- Access aspect metadata

Important for:
- Restricting searches to Motors
- Identifying relevant part attributes (MPN, Brand, etc.)

Categories are hierarchical.
Motors inventory must be scoped to correct subtree.

---

## 3.4 Order API

Endpoint:
POST /buy/order/v1/checkout_session/initiate

Requires:
- User OAuth token
- Buyer context

Capabilities:
- Create checkout session
- Apply shipping
- Complete order

Cannot bypass user authentication.

---

# 4. Motors-Specific Data

Motors listings may contain:

- MPN (Manufacturer Part Number)
- Brand
- OEM number (in aspects)
- Condition (New/Used/Refurbished)
- Compatibility (vehicle fitment)

Compatibility appears under:
- compatibilityProperties
- aspects fields
- seller-provided structured data

Fitment data is not guaranteed.
Sellers may omit or misstructure it.

---

# 5. Rate Limits

- Default daily limits depend on approval tier.
- Typically several thousand calls/day initially.
- Higher limits available upon request.

Limits apply per API.

Best practice:
- Cache tokens
- Cache search results
- Avoid unnecessary detail calls
- Implement exponential backoff

---

# 6. Data Freshness

Browse API returns live inventory.

Important behaviors:
- Listings may disappear between search and detail fetch.
- Auctions may change price dynamically.
- Availability can change rapidly.

System design should tolerate:
- 404 on detail fetch
- Outdated pricing
- Shipping recalculations

---

# 7. Error Model

Standard REST behavior:
- 200 OK
- 4xx client errors
- 5xx server errors

Error responses include:
- errorId
- domain
- category
- message

Implement:
- Retry for 5xx
- Do not retry for 4xx except rate limits
- Circuit breaker for sustained failures

---

# 8. Pagination

Search supports:
- limit
- offset

Max limit per page: 200

Total result count provided in response.
Deep pagination may degrade performance.

---

# 9. Data Compliance & Display Rules

When displaying listing data, must:

- Show seller name
- Show accurate price
- Not alter listing meaning
- Respect branding guidelines

Review eBay API License Agreement before production deployment.

---

# 10. Sandbox vs Production

Sandbox:
- Simulated inventory
- Limited Motors realism

Production:
- Real listings
- Required for realistic testing

Most Motors-related development requires production keys.

---

# 11. Security Considerations

- Store client secret securely
- Do not expose app token in frontend
- Use server-side proxy for API calls
- Rotate keys if compromised
- Encrypt refresh tokens if stored

---

# 12. Known Practical Constraints

- Fitment data is inconsistent
- Seller-provided attributes vary
- OEM numbers may be free-text
- Condition categorization may differ
- Shipping costs may not be final until checkout

System should assume imperfect data.

---

# 13. High-Level Integration Surface

Minimal integration requires:

- Identity API (client credentials flow)
- Browse API
- Item API
- Category ID from Taxonomy API

Order flow adds:
- Authorization code flow
- Order API

---

# 14. Mental Model Summary

eBay Buy APIs provide:

- Searchable live inventory
- Seller-owned listings
- Structured but imperfect attribute data
- OAuth-based secure access
- Optional buyer-side order orchestration

There is no guaranteed canonical parts database.
Listings are marketplace-driven and seller-authored.

Design systems defensively.