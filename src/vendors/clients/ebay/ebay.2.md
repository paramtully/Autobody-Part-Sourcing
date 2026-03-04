# eBay APIs for Aggregating & Purchasing Car Parts Listings

Source platform: **:contentReference[oaicite:0]{index=0}**

Base REST URL (Production):  
`https://api.ebay.com`

Base REST URL (Sandbox):  
`https://api.sandbox.ebay.com`

All modern APIs use **JSON** over **HTTPS**.

---

# 🔐 AUTHENTICATION (OAuth 2.0)

eBay uses OAuth 2.0.

## 1️⃣ Application Token (Client Credentials Flow)
Used for:
- Search listings
- Get item details

### Steps
1. Create app at https://developer.ebay.com
2. Get:
   - Client ID
   - Client Secret
3. Request token:

```http
POST https://api.ebay.com/identity/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>
````

Body:

```
grant_type=client_credentials
scope=https://api.ebay.com/oauth/api_scope
```

Response:

```json
{
  "access_token": "v^1.1#i^1#...",
  "expires_in": 7200,
  "token_type": "Application Access Token"
}
```

Use:

```
Authorization: Bearer <access_token>
```

---

## 2️⃣ User Token (Authorization Code Flow)

Required for:

* Checkout
* Place order

### Steps

1. Redirect user to:

```
https://auth.ebay.com/oauth2/authorize?
 client_id=<CLIENT_ID>
 &response_type=code
 &redirect_uri=<REDIRECT_URI>
 &scope=https://api.ebay.com/oauth/api_scope/buy.order
```

2. Exchange code:

```http
POST https://api.ebay.com/identity/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(client_id:client_secret)>
```

Body:

```
grant_type=authorization_code
code=<auth_code>
redirect_uri=<REDIRECT_URI>
```

Store:

* access_token
* refresh_token

Refresh:

```
grant_type=refresh_token
```

## 1️⃣ Browse API — Search / List Items

### Endpoint
`GET /buy/browse/v1/item_summary/search`

### Purpose
Search active listings (e.g., car parts) by keyword, category, filters.

### Auth Required?
✅ **Yes** — OAuth 2.0 (Application access token)

Scope:
```

[https://api.ebay.com/oauth/api_scope](https://api.ebay.com/oauth/api_scope)

````

### Example Request
```http
GET /buy/browse/v1/item_summary/search?q=ford+f150+bumper&limit=50
Authorization: Bearer <app_access_token>
````

### Response Type

* `application/json`
* Returns: **ItemSearchResponse**

### Response Format (Simplified)

```json
{
  "href": "string",
  "total": 0,
  "next": "string",
  "limit": 0,
  "offset": 0,
  "itemSummaries": [
    {
      "itemId": "string",
      "title": "string",
      "leafCategoryIds": ["string"],
      "categories": [
        {
          "categoryId": "string",
          "categoryName": "string"
        }
      ],
      "image": {
        "imageUrl": "string"
      },
      "additionalImages": [
        { "imageUrl": "string" }
      ],
      "price": {
        "value": "string",
        "currency": "string"
      },
      "strikeThroughPrice": {
        "value": "string",
        "currency": "string"
      },
      "itemLocation": {
        "city": "string",
        "stateOrProvince": "string",
        "postalCode": "string",
        "country": "string"
      },
      "seller": {
        "username": "string",
        "feedbackPercentage": "string",
        "feedbackScore": 0
      },
      "condition": "string",
      "conditionId": "string",
      "shippingOptions": [
        {
          "shippingCostType": "string",
          "shippingCost": {
            "value": "string",
            "currency": "string"
          }
        }
      ],
      "buyingOptions": ["FIXED_PRICE","AUCTION"],
      "currentBidPrice": {
        "value": "string",
        "currency": "string"
      },
      "epid": "string",
      "itemAffiliateWebUrl": "string",
      "itemWebUrl": "string",
      "itemEndDate": "string",
      "itemCreationDate": "string",
      "priorityListing": true,
      "adultOnly": false,
      "legacyItemId": "string",
      "availableCoupons": true
    }
  ]
}
```

### Important Query Params for Your Use Case

* `q` → keyword search
* `category_ids` → auto parts category
* `filter` → e.g. `price:[100..500]`, `conditions:{USED}`
* `limit` / `offset` → pagination

### Important Error Codes

| Status | Meaning             | What It Means For You           |
| ------ | ------------------- | ------------------------------- |
| 400    | Bad Request         | Invalid filter or query param   |
| 401    | Unauthorized        | Missing/expired OAuth token     |
| 403    | Forbidden           | App not approved for Browse API |
| 429    | Rate Limit Exceeded | Throttle requests               |
| 500    | Internal Error      | Retry with backoff              |

---

## 2️⃣ Browse API — Get Item Details

### Endpoint

`GET /buy/browse/v1/item/{item_id}`

### Purpose

Retrieve full structured details for a specific listing.

### Auth Required?

✅ **Yes** — OAuth 2.0 (Application access token)

### Example Request

```http
GET /buy/browse/v1/item/v1|1234567890|0
Authorization: Bearer <app_access_token>
```

### Response Type

* `application/json`
* Returns: **Item**

### Response Format (Simplified)

```json
{
  "itemId": "string",
  "title": "string",
  "subtitle": "string",
  "shortDescription": "string",
  "description": "string",
  "price": {
    "value": "string",
    "currency": "string"
  },
  "condition": "string",
  "conditionId": "string",
  "seller": {
    "username": "string",
    "feedbackPercentage": "string",
    "feedbackScore": 0
  },
  "estimatedAvailability": {
    "estimatedAvailableQuantity": 0,
    "estimatedSoldQuantity": 0
  },
  "itemLocation": {
    "city": "string",
    "stateOrProvince": "string",
    "postalCode": "string",
    "country": "string"
  },
  "shippingOptions": [
    {
      "shippingCostType": "string",
      "shippingCost": {
        "value": "string",
        "currency": "string"
      },
      "maxEstimatedDeliveryDate": "string",
      "minEstimatedDeliveryDate": "string"
    }
  ],
  "returnTerms": {
    "returnsAccepted": true,
    "refundMethod": "string",
    "returnShippingCostPayer": "string",
    "returnPeriod": {
      "value": 0,
      "unit": "string"
    }
  },
  "primaryCategory": {
    "categoryId": "string",
    "categoryName": "string"
  },
  "additionalImages": [
    { "imageUrl": "string" }
  ],
  "itemWebUrl": "string",
  "legacyItemId": "string",
  "warnings": [
    {
      "errorId": 0,
      "message": "string",
      "category": "string",
      "domain": "string",
      "subdomain": "string"
    }
  ]
}
```

### Important Error Codes

| Status | Meaning         | What It Means            |
| ------ | --------------- | ------------------------ |
| 400    | Invalid item ID | Item format incorrect    |
| 404    | Not Found       | Listing ended or removed |
| 401    | Unauthorized    | Token missing/expired    |
| 429    | Rate Limited    | Implement retry strategy |

---

## 3️⃣ Buy Order API — Create Purchase

### Endpoint

`POST /buy/order/v1/checkout_session`

### Purpose

Create checkout session for purchasing item.

### Auth Required?

✅ **Yes — User OAuth (Authorization Code Flow)**
You need the buyer’s permission.

Scope:

```
https://api.ebay.com/oauth/api_scope/buy.order
```

### Example Request

```http
POST /buy/order/v1/checkout_session
Authorization: Bearer <user_access_token>
Content-Type: application/json
```

```json
{
  "checkoutSessionId": "string",
  "lineItems": [
    {
      "itemId": "string",
      "quantity": 0,
      "lineItemCost": {
        "value": "string",
        "currency": "string"
      }
    }
  ],
  "pricingSummary": {
    "priceSubtotal": {
      "value": "string",
      "currency": "string"
    },
    "deliveryCost": {
      "value": "string",
      "currency": "string"
    },
    "tax": {
      "value": "string",
      "currency": "string"
    },
    "total": {
      "value": "string",
      "currency": "string"
    }
  },
  "shippingAddress": {
    "fullName": "string",
    "contactAddress": {
      "addressLine1": "string",
      "city": "string",
      "stateOrProvince": "string",
      "postalCode": "string",
      "countryCode": "string"
    }
  },
  "paymentMethod": {
    "paymentMethodType": "string"
  }
}
```

### Response Type

* `application/json`
* Returns: **CheckoutSession**

### Response Format (Simplified)

```json
{
  "checkoutSessionId": "12345",
  "lineItems": [...],
  "pricingSummary": {
    "total": {
      "value": "525.00",
      "currency": "USD"
    }
  },
  "paymentMethod": {...}
}
```

---

## 4️⃣ Buy Order API — Place Order

### Endpoint

`POST /buy/order/v1/checkout_session/{checkoutSessionId}/place_order`

### Purpose

Finalize purchase after payment method + shipping confirmed.

### Auth Required?

✅ **Yes — User OAuth**

### Response Type

* `application/json`
* Returns: **Order**

### Response Format (Simplified)

```json
{
  "orderId": "string",
  "creationDate": "string",
  "orderFulfillmentStatus": "NOT_STARTED",
  "orderPaymentStatus": "PAID",
  "pricingSummary": {
    "total": {
      "value": "string",
      "currency": "string"
    }
  },
  "lineItems": [
    {
      "lineItemId": "string",
      "itemId": "string",
      "quantity": 0,
      "lineItemStatus": "string"
    }
  ]
}
```

### Important Error Codes

| Code | Meaning             | Impact                       |
| ---- | ------------------- | ---------------------------- |
| 400  | Bad request         | Invalid params/body          |
| 401  | Unauthorized        | Token expired/invalid        |
| 403  | Buyer restricted    | Account blocked              |
| 404  | Not found           | Listing ended                |
| 409  | Conflict            | Out of stock                 |
| 422  | Checkout incomplete | Missing shipping/payment     |
| 429  | Rate limited        | Backoff required             |
| 500  | Server error        | Retry w/ exponential backoff |


---

# 🔐 Authentication Summary

| Use Case         | OAuth Type                     | User Required? |
| ---------------- | ------------------------------ | -------------- |
| Search listings  | App Token (Client Credentials) | ❌ No           |
| Get item details | App Token                      | ❌ No           |
| Purchase item    | User Token (Auth Code Flow)    | ✅ Yes          |

---

# 🧱 Recommended Architecture for Your Aggregator

1. Use **Browse Search API** to ingest listings.
2. Store:

   * itemId
   * title
   * price
   * seller
   * condition
3. Refresh listings periodically (watch for 404/ended items).
4. Only implement Buy Order API if you want in-app purchasing.
5. Otherwise, redirect to eBay listing URL.

