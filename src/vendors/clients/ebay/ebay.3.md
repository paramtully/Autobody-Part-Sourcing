Below is copy-paste ready Markdown documentation for the relevant **eBay Motors item retrieval endpoints**, including representative full response structures.

---

# eBay Motors Item Retrieval Documentation

API Provider: eBay
Scope: Buy Browse API + Trading API (GetItem)

---

# 1️⃣ Browse API — Search

## Endpoint

```
GET /buy/browse/v1/item_summary/search
```

## Purpose

Returns summarized search results.

## Example Request

```
GET /buy/browse/v1/item_summary/search?q=brake+pads&limit=50
```

## Full Response Structure

```json
{
  "href": "string",
  "total": 0,
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
      "price": {
        "value": "string",
        "currency": "string"
      },
      "itemLocation": {
        "postalCode": "string",
        "country": "string",
        "stateOrProvince": "string",
        "city": "string"
      },
      "seller": {
        "username": "string",
        "feedbackPercentage": "string",
        "feedbackScore": 0
      },
      "condition": "string",
      "conditionId": "string",
      "thumbnailImages": [
        {
          "imageUrl": "string"
        }
      ],
      "shippingOptions": [
        {
          "shippingCostType": "string",
          "shippingCost": {
            "value": "string",
            "currency": "string"
          }
        }
      ],
      "buyingOptions": ["string"],
      "itemAffiliateWebUrl": "string",
      "itemWebUrl": "string"
    }
  ]
}
```

---

# 2️⃣ Browse API — Get Item (With Product + Compatibility)

## Endpoint

```
GET /buy/browse/v1/item/{item_id}?fieldgroups=PRODUCT,COMPATIBILITY
```

## Purpose

Returns full item details including product catalog info and compatibility (if available).

## Full Response Structure

```json
{
  "itemId": "string",
  "title": "string",
  "shortDescription": "string",
  "description": "string",
  "price": {
    "value": "string",
    "currency": "string"
  },
  "categoryPath": "string",
  "condition": "string",
  "conditionId": "string",
  "brand": "string",
  "mpn": "string",
  "image": {
    "imageUrl": "string"
  },
  "additionalImages": [
    {
      "imageUrl": "string"
    }
  ],
  "seller": {
    "username": "string",
    "feedbackPercentage": "string",
    "feedbackScore": 0
  },
  "shippingOptions": [
    {
      "shippingCostType": "string",
      "shippingCost": {
        "value": "string",
        "currency": "string"
      }
    }
  ],

  "product": {
    "title": "string",
    "brand": "string",
    "mpn": "string",
    "aspects": {
      "Manufacturer Part Number": ["string"],
      "Brand": ["string"],
      "Placement on Vehicle": ["string"],
      "Other Aspect Name": ["string"]
    }
  },

  "compatibilityProperties": [
    {
      "name": "Year",
      "value": "2022"
    },
    {
      "name": "Make",
      "value": "GMC"
    },
    {
      "name": "Model",
      "value": "Sierra 2500 HD"
    },
    {
      "name": "Trim",
      "value": "Pro Extended Cab Pickup 4-Door"
    },
    {
      "name": "Engine",
      "value": "6.6L 6571CC 401Cu. In. V8 GAS OHV Naturally Aspirated"
    }
  ],

  "compatibilityMatch": {
    "compatibilityProperties": [
      {
        "name": "Year",
        "value": "string"
      },
      {
        "name": "Make",
        "value": "string"
      },
      {
        "name": "Model",
        "value": "string"
      }
    ]
  }
}
```

### Notes

* `compatibilityProperties` may be truncated for large fitment lists.
* Structure may vary depending on listing size.
* Not guaranteed to return full compatibility matrix.

---

# 3️⃣ Trading API — GetItem (Full Compatibility Matrix)

## Endpoint

```
POST https://api.ebay.com/ws/api.dll
```

## Required Request Fields

```xml
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>1234567890</ItemID>
  <IncludeItemCompatibilityList>true</IncludeItemCompatibilityList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>
```

---

## Full Response Structure (XML)

```xml
<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Timestamp>dateTime</Timestamp>
  <Ack>Success</Ack>
  <Item>
    <ItemID>string</ItemID>
    <Title>string</Title>
    <Description>string</Description>
    <PrimaryCategory>
      <CategoryID>string</CategoryID>
      <CategoryName>string</CategoryName>
    </PrimaryCategory>
    <StartPrice currencyID="USD">0.00</StartPrice>
    <ConditionID>1000</ConditionID>
    <ConditionDisplayName>New</ConditionDisplayName>
    <ListingDetails>
      <StartTime>dateTime</StartTime>
      <EndTime>dateTime</EndTime>
      <ViewItemURL>string</ViewItemURL>
    </ListingDetails>
    <Seller>
      <UserID>string</UserID>
      <FeedbackScore>0</FeedbackScore>
      <PositiveFeedbackPercent>0.0</PositiveFeedbackPercent>
    </Seller>

    <ItemSpecifics>
      <NameValueList>
        <Name>Brand</Name>
        <Value>string</Value>
      </NameValueList>
      <NameValueList>
        <Name>Manufacturer Part Number</Name>
        <Value>string</Value>
      </NameValueList>
    </ItemSpecifics>

    <ItemCompatibilityList>
      <Compatibility>
        <NameValueList>
          <Name>Year</Name>
          <Value>2022</Value>
        </NameValueList>
        <NameValueList>
          <Name>Make</Name>
          <Value>GMC</Value>
        </NameValueList>
        <Name>Model</Name>
        <Value>Sierra 2500 HD</Value>
        <NameValueList>
          <Name>Trim</Name>
          <Value>Pro Extended Cab Pickup 4-Door</Value>
        </NameValueList>
        <NameValueList>
          <Name>Engine</Name>
          <Value>6.6L 6571CC 401Cu. In. V8 GAS OHV Naturally Aspirated</Value>
        </NameValueList>
      </Compatibility>

      <!-- Repeated for each compatible vehicle -->
    </ItemCompatibilityList>
  </Item>
</GetItemResponse>
```

---

# Comparison Summary

| Feature                   | Browse API            | Trading GetItem      |
| ------------------------- | --------------------- | -------------------- |
| Format                    | JSON                  | XML                  |
| Full Compatibility Matrix | ❌ Not guaranteed      | ✅ Yes                |
| Modern REST               | ✅                     | ❌                    |
| Complete Listing Data     | Moderate              | Very Detailed        |
| Best For                  | Search + light detail | Motors compatibility |

---

# Recommended Production Pattern

1. Use Browse API for search.
2. Use Trading `GetItem` for compatibility.
3. Convert XML → JSON.
4. Normalize into internal schema:

   * `year`
   * `make`
   * `model`
   * `engine`
   * additional fields as needed.

---

If you want, I can next provide:

* A normalized JSON schema you can standardize on
* A TypeScript interface set
* Or an XML → JSON transformation example
