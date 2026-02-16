/**
 * HTML parser for Car-Part.com web pages.
 *
 * Fallback/enrichment path when the REST API is unavailable or
 * when scraping provides richer data (e.g., images, detailed descriptions).
 *
 * Uses regex-based parsing rather than DOM parsing (no Cheerio dependency)
 * to keep the infrastructure package lightweight. If richer HTML parsing
 * is needed later, Cheerio can be added as an optional dependency.
 *
 * This parser is stateless and has no side effects.
 */

import type { UnknownRawVendorRecord } from '../../inventoryClient';

/**
 * A single parsed listing from Car-Part.com HTML.
 */
export interface ParsedCarPartListing {
  /** Extracted listing ID (from URL or data attribute). */
  listingId: string;

  /** Part description. */
  description: string;

  /** Price in USD (may be null if "Call for price"). */
  price: number | null;

  /** Yard/seller name. */
  yardName: string;

  /** Yard location (city, state). */
  yardLocation: string;

  /** Yard phone number. */
  yardPhone: string;

  /** Part status from the listing. */
  partStatus: 'available' | 'limited' | 'out_of_stock' | 'unknown';

  /** Mileage from donor vehicle. */
  mileage: number | null;

  /** Stock number at the yard. */
  stockNumber: string;

  /** Image URLs if present. */
  imageUrls: string[];

  /** Source URL for this listing. */
  sourceUrl: string;

  /** Make of the vehicle. */
  make: string;

  /** Model of the vehicle. */
  model: string;

  /** Year range start. */
  yearFrom: number | null;

  /** Year range end. */
  yearTo: number | null;

  /** Hollander interchange number if found. */
  hollanderNumber: string | null;
}

/**
 * Parse Car-Part.com search results HTML into structured records.
 *
 * @param html - Raw HTML string from Car-Part.com search results page
 * @param baseUrl - Base URL for constructing absolute URLs
 * @returns Array of parsed listing records
 */
export function parseCarPartSearchResults(
  html: string,
  baseUrl: string = 'https://www.car-part.com'
): ParsedCarPartListing[] {
  const listings: ParsedCarPartListing[] = [];

  // Car-Part.com uses table rows for listings with class "listing-row" or similar
  // Match listing blocks: they typically have a pattern of yard info + part info + price
  const listingPattern = /<tr[^>]*class="[^"]*(?:listing|result)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;

  while ((match = listingPattern.exec(html)) !== null) {
    const rowHtml = match[1];
    const parsed = parseListingRow(rowHtml, baseUrl);
    if (parsed) {
      listings.push(parsed);
    }
  }

  // Fallback: If no table-based listings found, try div-based structure
  if (listings.length === 0) {
    const divPattern = /<div[^>]*class="[^"]*(?:listing|result|part-item)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*(?:listing|result|part-item)|$)/gi;
    while ((match = divPattern.exec(html)) !== null) {
      const divHtml = match[1];
      const parsed = parseListingDiv(divHtml, baseUrl);
      if (parsed) {
        listings.push(parsed);
      }
    }
  }

  return listings;
}

/**
 * Convert parsed Car-Part.com listings to UnknownRawVendorRecords
 * suitable for the VendorInventoryClient interface.
 *
 * @param listings - Parsed listings from HTML
 * @param vendorId - The vendor ID for these listings
 * @returns Raw vendor records compatible with the pipeline
 */
export function parsedListingsToRecords(
  listings: ParsedCarPartListing[],
  vendorId: string
): UnknownRawVendorRecord[] {
  return listings.map((listing) => ({
    id: listing.listingId,
    vendorListingId: listing.listingId,
    description: listing.description,
    price: listing.price,
    currency: 'USD',
    yardName: listing.yardName,
    yardLocation: listing.yardLocation,
    yardPhone: listing.yardPhone,
    partStatus: listing.partStatus,
    mileage: listing.mileage,
    yardStockNumber: listing.stockNumber,
    sourceUrl: listing.sourceUrl,
    make: listing.make,
    model: listing.model,
    yearFrom: listing.yearFrom,
    yearTo: listing.yearTo,
    hollanderNumber: listing.hollanderNumber,
    images: listing.imageUrls.map((url, i) => ({
      url,
      type: i === 0 ? 'PRIMARY' : 'ADDITIONAL',
    })),
    isActive: listing.partStatus !== 'out_of_stock',
    vendorId,
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * Parse a single table-row listing.
 */
function parseListingRow(rowHtml: string, baseUrl: string): ParsedCarPartListing | null {
  const listingId = extractAttribute(rowHtml, 'data-listing-id') ??
                    extractAttribute(rowHtml, 'data-id') ??
                    extractLinkId(rowHtml);

  if (!listingId) return null;

  return {
    listingId,
    description: extractTextContent(rowHtml, 'description') ?? extractTextContent(rowHtml, 'part-name') ?? '',
    price: extractPrice(rowHtml),
    yardName: extractTextContent(rowHtml, 'yard-name') ?? extractTextContent(rowHtml, 'seller') ?? '',
    yardLocation: extractTextContent(rowHtml, 'yard-location') ?? extractTextContent(rowHtml, 'location') ?? '',
    yardPhone: extractTextContent(rowHtml, 'yard-phone') ?? extractTextContent(rowHtml, 'phone') ?? '',
    partStatus: extractPartStatus(rowHtml),
    mileage: extractNumber(rowHtml, /(\d[\d,]*)\s*(?:mi|miles)/i),
    stockNumber: extractTextContent(rowHtml, 'stock') ?? listingId,
    imageUrls: extractImageUrls(rowHtml, baseUrl),
    sourceUrl: extractListingUrl(rowHtml, baseUrl),
    make: extractTextContent(rowHtml, 'make') ?? '',
    model: extractTextContent(rowHtml, 'model') ?? '',
    yearFrom: extractNumber(rowHtml, /(\d{4})\s*-/),
    yearTo: extractNumber(rowHtml, /-\s*(\d{4})/),
    hollanderNumber: extractTextContent(rowHtml, 'hollander') ?? extractTextContent(rowHtml, 'interchange') ?? null,
  };
}

/**
 * Parse a single div-based listing.
 */
function parseListingDiv(divHtml: string, baseUrl: string): ParsedCarPartListing | null {
  return parseListingRow(divHtml, baseUrl); // Same extraction logic applies
}

/**
 * Extract a data attribute value from HTML.
 */
function extractAttribute(html: string, attr: string): string | null {
  const pattern = new RegExp(`${attr}="([^"]*)"`, 'i');
  const match = pattern.exec(html);
  return match ? match[1] : null;
}

/**
 * Extract text content from an element with a matching class.
 */
function extractTextContent(html: string, className: string): string | null {
  const pattern = new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([^<]+)`, 'i');
  const match = pattern.exec(html);
  return match ? match[1].trim() : null;
}

/**
 * Extract price from HTML content.
 */
function extractPrice(html: string): number | null {
  const priceMatch = /\$\s*([\d,]+(?:\.\d{2})?)/i.exec(html);
  if (priceMatch) {
    return parseFloat(priceMatch[1].replace(/,/g, ''));
  }
  return null;
}

/**
 * Extract a number from HTML using a regex pattern.
 */
function extractNumber(html: string, pattern: RegExp): number | null {
  const match = pattern.exec(html);
  if (match) {
    const num = parseInt(match[1].replace(/,/g, ''), 10);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Extract part status from HTML.
 */
function extractPartStatus(html: string): ParsedCarPartListing['partStatus'] {
  const lower = html.toLowerCase();
  if (lower.includes('out of stock') || lower.includes('sold')) return 'out_of_stock';
  if (lower.includes('limited') || lower.includes('low stock')) return 'limited';
  if (lower.includes('available') || lower.includes('in stock')) return 'available';
  return 'unknown';
}

/**
 * Extract image URLs from HTML.
 */
function extractImageUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const imgPattern = /src="([^"]*(?:\.jpg|\.jpeg|\.png|\.webp)[^"]*)"/gi;
  let match: RegExpExecArray | null;
  while ((match = imgPattern.exec(html)) !== null) {
    const url = match[1];
    if (url.startsWith('http')) {
      urls.push(url);
    } else {
      urls.push(`${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`);
    }
  }
  return urls;
}

/**
 * Extract listing URL from an anchor tag.
 */
function extractListingUrl(html: string, baseUrl: string): string {
  const hrefMatch = /href="([^"]*(?:detail|listing|part)[^"]*)"/i.exec(html);
  if (hrefMatch) {
    const href = hrefMatch[1];
    return href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
  }
  return baseUrl;
}

/**
 * Extract listing ID from a link URL.
 */
function extractLinkId(html: string): string | null {
  const hrefMatch = /href="[^"]*(?:id|listing|part)[=\/]([^"&]+)"/i.exec(html);
  return hrefMatch ? hrefMatch[1] : null;
}
