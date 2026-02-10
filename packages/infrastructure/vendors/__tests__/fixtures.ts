/**
 * Test fixtures and utilities for vendor inventory ingestion tests.
 */

import type { VendorInventoryDTO } from '../dto/vendorInventoryDTO';
import type { VendorInventoryClient } from '../inventoryClient';
import type { PartCondition } from '@domain/listing/partCondition';
import type { AvailabilityStatus } from '@domain/listing/availabilityStatus';
import type { Currency } from '@domain/listing/currency';
import type { DataSourceType } from '@domain/listing/dataSourceType';

/**
 * Generate a valid VendorInventoryDTO for testing.
 */
export function createValidVendorInventoryDTO(
  overrides?: Partial<VendorInventoryDTO>
): VendorInventoryDTO {
  const now = new Date().toISOString();
  return {
    vendorId: 'test-vendor-id',
    vendorListingExternalId: 'test-listing-123',
    sourceUrl: 'https://vendor.com/listing/123',
    normalizedPartNumberCandidates: ['OEM123', 'AFT456'],
    canonicalPayloadJson: JSON.stringify({ id: '123', price: 100 }),
    payloadHash: 'test-hash-123',
    ingestedAt: now,
    condition: 'NEW_OEM' as PartCondition,
    availabilityStatus: 'IN_STOCK' as AvailabilityStatus,
    isActive: true,
    priceMinorMin: 10000,
    currency: 'USD' as Currency,
    dataSource: 'VENDOR_API' as DataSourceType,
    ...overrides,
  };
}

/**
 * Generate an invalid VendorInventoryDTO (missing required fields).
 */
export function createInvalidVendorInventoryDTO(): Partial<VendorInventoryDTO> {
  return {
    vendorId: 'test-vendor-id',
    // Missing required fields
  };
}

/**
 * Mock vendor inventory response (valid).
 */
export function createMockVendorResponse() {
  return {
    listings: [
      {
        id: 'listing-1',
        partNumber: 'OEM123',
        condition: 'NEW_OEM',
        price: 100.00,
        currency: 'USD',
        quantity: 5,
        availability: 'IN_STOCK',
      },
      {
        id: 'listing-2',
        partNumber: 'AFT456',
        condition: 'NEW_AFTERMARKET',
        price: 75.50,
        currency: 'USD',
        quantity: 10,
        availability: 'IN_STOCK',
      },
    ],
    nextCursor: 'cursor-123',
    hasMore: true,
  };
}

/**
 * Mock vendor inventory response (invalid - missing identity).
 */
export function createInvalidMockVendorResponse() {
  return {
    listings: [
      {
        // Missing id, url, etc.
        partNumber: 'OEM123',
        price: 100.00,
      },
    ],
  };
}

/**
 * Mock vendor inventory response (empty).
 */
export function createEmptyMockVendorResponse() {
  return {
    listings: [],
    hasMore: false,
  };
}

/**
 * Mock VendorInventoryClient implementation for testing.
 */
export class MockVendorInventoryClient implements VendorInventoryClient {
  private records: unknown[] = [];
  private shouldFail = false;
  private failError?: Error;
  private healthStatus: 'healthy' | 'degraded' | 'down' = 'healthy';

  setRecords(records: unknown[]) {
    this.records = records;
  }

  setShouldFail(shouldFail: boolean, error?: Error) {
    this.shouldFail = shouldFail;
    this.failError = error;
  }

  setHealthStatus(status: 'healthy' | 'degraded' | 'down') {
    this.healthStatus = status;
  }

  async *fetchInventoryStream(): AsyncIterable<unknown> {
    if (this.shouldFail && this.failError) {
      throw this.failError;
    }
    for (const record of this.records) {
      yield record;
    }
  }

  async fetchInventoryPage(cursor?: string): Promise<{
    records: unknown[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    if (this.shouldFail && this.failError) {
      throw this.failError;
    }
    const startIndex = cursor ? parseInt(cursor, 10) : 0;
    const batchSize = 10;
    const endIndex = startIndex + batchSize;
    const hasMore = endIndex < this.records.length;

    return {
      records: this.records.slice(startIndex, endIndex),
      nextCursor: hasMore ? endIndex.toString() : undefined,
      hasMore,
    };
  }

  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    latencyMs: number;
    lastSuccessAt?: Date;
    error?: string;
  }> {
    return {
      status: this.healthStatus,
      latencyMs: 50,
      lastSuccessAt: this.healthStatus !== 'down' ? new Date() : undefined,
      error: this.healthStatus === 'down' ? 'Vendor API is down' : undefined,
    };
  }

  getVendorCapabilities() {
    return {
      supportsStreaming: true,
      supportsRealtimeLookup: false,
      supportsImages: true,
      supportsFitment: true,
      supportsBulkPagination: true,
      expectedUpdateFrequencyMinutes: 30,
      maxRecordsPerRequest: 1000,
      rateLimitRequestsPerMinute: 60,
    };
  }
}

/**
 * Assertion helper for structured logging.
 */
export function assertStructuredLog(log: unknown): asserts log is {
  level: string;
  vendorId: string;
  correlationId: string;
  errorType?: string;
  retryAttempt?: number;
  message: string;
} {
  if (typeof log !== 'object' || log === null) {
    throw new Error('Log must be an object');
  }

  const logObj = log as Record<string, unknown>;
  if (typeof logObj.level !== 'string') {
    throw new Error('Log must have level field');
  }
  if (typeof logObj.vendorId !== 'string') {
    throw new Error('Log must have vendorId field');
  }
  if (typeof logObj.correlationId !== 'string') {
    throw new Error('Log must have correlationId field');
  }
}

/**
 * Assertion helper for idempotency.
 */
export function assertIdempotent<T>(
  firstResult: T,
  secondResult: T,
  equalityFn?: (a: T, b: T) => boolean
): void {
  const areEqual = equalityFn
    ? equalityFn(firstResult, secondResult)
    : JSON.stringify(firstResult) === JSON.stringify(secondResult);

  if (!areEqual) {
    throw new Error(
      `Results are not equal (not idempotent):\nFirst: ${JSON.stringify(firstResult)}\nSecond: ${JSON.stringify(secondResult)}`
    );
  }
}

/**
 * Performance measurement utility.
 */
export class PerformanceTimer {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  reset(): void {
    this.startTime = Date.now();
  }
}
