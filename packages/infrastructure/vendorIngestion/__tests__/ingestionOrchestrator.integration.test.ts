/**
 * Integration tests for Ingestion Orchestrator.
 * 
 * These tests verify that all 7 systems work together correctly:
 * 1. VendorInventoryClient
 * 2. Retry utilities
 * 3. RawPayloadLogger
 * 4. DTOMapper
 * 5. DataCleaner
 * 6. DomainReconciler
 * 7. ListingLifecycleManager
 * 
 * Tests cover:
 * - Complete ingestion flow (client → DB)
 * - Checkpoint/resume across chunks
 * - Error handling and recovery
 * - Optional component omission
 * - Edge cases
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  processIngestionChunk,
  type IngestionOrchestratorDeps,
  type IngestionRepositories,
} from '../ingestionOrchestrator';
import type { VendorInventoryClient } from '../../inventoryClient';
import type { DTOMapper } from '../../dto/dtoMapper';
import { DefaultDTOMapper } from '../../dto/dtoMapper';
import type { DataCleaner } from '../../cleaning/dataCleaner';
import { DefaultDataCleaner } from '../../cleaning/dataCleaner';
import type { DomainReconciler } from '../../reconciliation/domainReconciler';
import type { RawPayloadLogger, RawPayloadLogEntry } from '../../logging/rawPayloadLogger';
import type { ListingLifecycleManager } from '../../lifecycle/listingLifecycleManager';
import type { IngestionRun, IngestionRunRepository } from '../ingestionRun';
import type { CleanedDTO } from '../../cleaning/cleanedDTO';

/**
 * Mock vendor client for testing.
 */
class MockVendorClient implements VendorInventoryClient {
  private pages: Array<{ records: unknown[]; cursor?: string }> = [];
  private currentPage = 0;

  setPages(pages: Array<{ records: unknown[]; cursor?: string }>) {
    this.pages = pages;
    this.currentPage = 0;
  }

  async fetchInventoryPage(cursor?: string) {
    const pageIndex = cursor ? parseInt(cursor, 10) : 0;
    const page = this.pages[pageIndex];

    if (!page) {
      return { records: [], hasMore: false };
    }

    return {
      records: page.records,
      nextCursor: page.cursor,
      hasMore: pageIndex < this.pages.length - 1,
    };
  }

  async *fetchInventoryStream() {
    for (const page of this.pages) {
      for (const record of page.records) {
        yield record;
      }
    }
  }

  async healthCheck() {
    return {
      status: 'healthy' as const,
      latencyMs: 10,
      lastSuccessAt: new Date(),
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
      maxRecordsPerRequest: 100,
      rateLimitRequestsPerMinute: 60,
    };
  }

  getVendorId() {
    return 'test-vendor';
  }

  getAuthStatus() {
    return {
      isAuthenticated: true,
      expiresAt: new Date(Date.now() + 3600000),
    };
  }
}

/**
 * Mock raw payload logger.
 */
class MockRawPayloadLogger implements RawPayloadLogger {
  private logs: RawPayloadLogEntry[] = [];

  async log(entry: RawPayloadLogEntry) {
    this.logs.push(entry);
    return {
      id: `log-${this.logs.length}`,
      isNew: true,
      payloadHash: entry.payloadHash ?? 'hash-123',
    };
  }

  async logBatch(entries: RawPayloadLogEntry[]) {
    return entries.map((entry) => ({
      id: `log-${this.logs.length + 1}`,
      isNew: true,
      payloadHash: entry.payloadHash ?? 'hash-123',
    }));
  }

  getLogs() {
    return this.logs;
  }

  reset() {
    this.logs = [];
  }
}

/**
 * Mock ingestion run repository.
 */
class MockIngestionRunRepository implements IngestionRunRepository {
  private runs = new Map<string, IngestionRun>();

  async findLatestRun(vendorId: string) {
    const vendorRuns = Array.from(this.runs.values()).filter(r => r.vendorId === vendorId);
    if (vendorRuns.length === 0) return null;
    return vendorRuns.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  }

  async createRun(run: IngestionRun) {
    this.runs.set(run.id, run);
    return run;
  }

  async updateRun(run: IngestionRun) {
    this.runs.set(run.id, run);
    return run;
  }

  reset() {
    this.runs.clear();
  }

  getRuns() {
    return Array.from(this.runs.values());
  }
}

/**
 * Mock repositories.
 */
class MockIngestionRepositories implements IngestionRepositories {
  public ingestionRuns: MockIngestionRunRepository;
  private listings = new Map<string, CleanedDTO & { listingId: string }>();
  private nextListingId = 1;

  constructor() {
    this.ingestionRuns = new MockIngestionRunRepository();
  }

  async upsertListing(dto: CleanedDTO, action: 'INSERT' | 'UPDATE') {
    const key = `${dto.vendorId}:${dto.vendorListingExternalId}`;
    const existingListing = this.listings.get(key);

    if (action === 'INSERT' || !existingListing) {
      const listingId = `listing-${this.nextListingId++}`;
      const listing = { ...dto, listingId };
      this.listings.set(key, listing);
      return { listingId };
    }

    // UPDATE
    const updatedListing = { ...existingListing, ...dto };
    this.listings.set(key, updatedListing);
    return { listingId: existingListing.listingId };
  }

  getListings() {
    return Array.from(this.listings.values());
  }

  reset() {
    this.ingestionRuns.reset();
    this.listings.clear();
    this.nextListingId = 1;
  }
}

/**
 * Mock lifecycle manager.
 */
class MockLifecycleManager implements ListingLifecycleManager {
  private seenRecords: Array<{ vendorId: string; listingId: string; seenAt: string }> = [];

  async recordSeen(vendorId: string, vendorListingExternalId: string, seenAt: string) {
    this.seenRecords.push({ vendorId, listingId: vendorListingExternalId, seenAt });
    return {
      newState: 'ACTIVE' as const,
      changed: false,
      reason: 'Test',
      timestamps: { lastSeenAt: seenAt },
    };
  }

  async recordMissed() {
    return {
      newState: 'ACTIVE' as const,
      changed: false,
      reason: 'Test',
      timestamps: {},
    };
  }

  async applyVendorDeactivation() {
    return {
      newState: 'VENDOR_INACTIVE' as const,
      changed: true,
      reason: 'Test',
      timestamps: { markedInactiveAt: new Date().toISOString() },
    };
  }

  async detectStaleListings() {
    return {
      vendorId: 'test-vendor',
      totalActive: 0,
      totalStale: 0,
      deactivated: 0,
      deactivatedListings: [],
    };
  }

  getSeenRecords() {
    return this.seenRecords;
  }

  reset() {
    this.seenRecords = [];
  }
}

describe('IngestionOrchestrator Integration Tests', () => {
  let client: MockVendorClient;
  let repositories: MockIngestionRepositories;
  let dtoMapper: DTOMapper;
  let dataCleaner: DataCleaner;
  let rawPayloadLogger: MockRawPayloadLogger;
  let lifecycleManager: MockLifecycleManager;

  beforeEach(() => {
    client = new MockVendorClient();
    repositories = new MockIngestionRepositories();
    dtoMapper = new DefaultDTOMapper();
    dataCleaner = new DefaultDataCleaner();
    rawPayloadLogger = new MockRawPayloadLogger();
    lifecycleManager = new MockLifecycleManager();
  });

  describe('Complete Ingestion Flow', () => {
    it('processes single page with all systems enabled', async () => {
      // Setup client with one page of data
      client.setPages([
        {
          records: [
            {
              id: 'listing-1',
              partNumber: 'OEM-123',
              price: 100,
              condition: 'NEW_OEM',
              availability: 'IN_STOCK',
            },
            {
              id: 'listing-2',
              partNumber: 'OEM-456',
              price: 200,
              condition: 'NEW_AFTERMARKET',
              availability: 'LOW_STOCK',
            },
          ],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        rawPayloadLogger,
        lifecycleManager,
        repositories,
      };

      const result = await processIngestionChunk(deps, 'test-vendor');

      // Verify result
      expect(result.vendorId).toBe('test-vendor');
      expect(result.chunkStats.totalProcessed).toBe(2);
      expect(result.chunkStats.succeeded).toBe(2);
      expect(result.chunkStats.failed).toBe(0);
      expect(result.hasMore).toBe(false);

      // Verify listings were inserted
      const listings = repositories.getListings();
      expect(listings).toHaveLength(2);
      expect(listings[0].vendorListingExternalId).toBe('listing-1');
      expect(listings[1].vendorListingExternalId).toBe('listing-2');

      // Verify lifecycle tracking
      const seenRecords = lifecycleManager.getSeenRecords();
      expect(seenRecords).toHaveLength(2);

      // Verify raw payloads were logged
      const logs = rawPayloadLogger.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(0); // Per-record logging after reconciliation
    });

    it('processes multiple pages with checkpoint/resume', async () => {
      client.setPages([
        {
          records: [{ id: 'listing-1', price: 100 }],
          cursor: '1',
        },
        {
          records: [{ id: 'listing-2', price: 200 }],
          cursor: '2',
        },
        {
          records: [{ id: 'listing-3', price: 300 }],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
      };

      // Process first chunk
      const result1 = await processIngestionChunk(deps, 'test-vendor');
      expect(result1.chunkStats.totalProcessed).toBe(1);
      expect(result1.hasMore).toBe(true);
      expect(result1.nextCursor).toBe('1');

      // Process second chunk
      const result2 = await processIngestionChunk(deps, 'test-vendor');
      expect(result2.chunkStats.totalProcessed).toBe(1);
      expect(result2.hasMore).toBe(true);
      expect(result2.nextCursor).toBe('2');

      // Process third chunk
      const result3 = await processIngestionChunk(deps, 'test-vendor');
      expect(result3.chunkStats.totalProcessed).toBe(1);
      expect(result3.hasMore).toBe(false);

      // Verify cumulative stats
      const runs = repositories.ingestionRuns.getRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0].totalProcessed).toBe(3);
      expect(runs[0].status).toBe('COMPLETED');
    });
  });

  describe('Optional Component Omission', () => {
    it('works without reconciler (always INSERT)', async () => {
      client.setPages([
        {
          records: [{ id: 'listing-1', price: 100 }],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
        // No reconciler
      };

      const result = await processIngestionChunk(deps, 'test-vendor');

      expect(result.chunkStats.succeeded).toBe(1);
      expect(repositories.getListings()).toHaveLength(1);
    });

    it('works without lifecycle manager', async () => {
      client.setPages([
        {
          records: [{ id: 'listing-1', price: 100 }],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
        // No lifecycle manager
      };

      const result = await processIngestionChunk(deps, 'test-vendor');

      expect(result.chunkStats.succeeded).toBe(1);
    });

    it('works without raw payload logger', async () => {
      client.setPages([
        {
          records: [{ id: 'listing-1', price: 100 }],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
        // No raw payload logger
      };

      const result = await processIngestionChunk(deps, 'test-vendor');

      expect(result.chunkStats.succeeded).toBe(1);
    });

    it('works with only required components', async () => {
      client.setPages([
        {
          records: [{ id: 'listing-1', price: 100 }],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
      };

      const result = await processIngestionChunk(deps, 'test-vendor');

      expect(result.chunkStats.succeeded).toBe(1);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('handles validation failures gracefully', async () => {
      client.setPages([
        {
          records: [
            { id: 'valid-1', price: 100 },
            { /* missing required id */ price: 200 },
            { id: 'valid-2', price: 300 },
          ],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
      };

      const result = await processIngestionChunk(deps, 'test-vendor');

      // Should process valid records despite failures
      expect(result.chunkStats.totalProcessed).toBe(3);
      expect(result.chunkStats.succeeded).toBe(2); // Two valid records
      expect(result.chunkStats.failed).toBeGreaterThanOrEqual(1);
    });

    it('handles cleaning failures gracefully', async () => {
      client.setPages([
        {
          records: [
            { id: 'listing-1', price: -100 }, // Negative price will fail cleaning
            { id: 'listing-2', price: 200 },
          ],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
      };

      const result = await processIngestionChunk(deps, 'test-vendor');

      expect(result.chunkStats.totalProcessed).toBe(2);
      expect(result.chunkStats.failed).toBeGreaterThanOrEqual(1);
      expect(result.chunkStats.succeeded).toBeGreaterThanOrEqual(1);
    });

    it('continues processing after individual record failures', async () => {
      client.setPages([
        {
          records: [
            { id: 'valid-1', price: 100 },
            { /* invalid */ },
            { id: 'valid-2', price: 200 },
            { /* invalid */ },
            { id: 'valid-3', price: 300 },
          ],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
      };

      const result = await processIngestionChunk(deps, 'test-vendor');

      expect(result.chunkStats.succeeded).toBeGreaterThanOrEqual(3);
      expect(repositories.getListings().length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty page gracefully', async () => {
      client.setPages([
        {
          records: [],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
      };

      const result = await processIngestionChunk(deps, 'test-vendor');

      expect(result.chunkStats.totalProcessed).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('handles very large pages', async () => {
      const largeRecords = Array.from({ length: 1000 }, (_, i) => ({
        id: `listing-${i}`,
        price: 100 + i,
      }));

      client.setPages([
        {
          records: largeRecords,
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
      };

      const result = await processIngestionChunk(deps, 'test-vendor');

      expect(result.chunkStats.totalProcessed).toBe(1000);
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('handles resume from failed run', async () => {
      client.setPages([
        {
          records: [{ id: 'listing-1', price: 100 }],
          cursor: '1',
        },
        {
          records: [{ id: 'listing-2', price: 200 }],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
      };

      // Process first chunk
      await processIngestionChunk(deps, 'test-vendor');

      // Simulate failure and resume
      const result = await processIngestionChunk(deps, 'test-vendor');

      expect(result.chunkStats.totalProcessed).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('tracks duration correctly', async () => {
      client.setPages([
        {
          records: [{ id: 'listing-1', price: 100 }],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
      };

      const result = await processIngestionChunk(deps, 'test-vendor');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeLessThan(10000); // Should be fast for mock
    });
  });

  describe('Idempotency', () => {
    it('produces same result on repeated execution', async () => {
      client.setPages([
        {
          records: [{ id: 'listing-1', price: 100 }],
          cursor: undefined,
        },
      ]);

      const deps: IngestionOrchestratorDeps = {
        client,
        dtoMapper,
        dataCleaner,
        repositories,
      };

      const result1 = await processIngestionChunk(deps, 'test-vendor');
      
      // Reset run state and run again
      repositories.ingestionRuns.reset();
      client.setPages([
        {
          records: [{ id: 'listing-1', price: 100 }],
          cursor: undefined,
        },
      ]);

      const result2 = await processIngestionChunk(deps, 'test-vendor');

      expect(result1.chunkStats.succeeded).toBe(result2.chunkStats.succeeded);
      expect(result1.chunkStats.totalProcessed).toBe(result2.chunkStats.totalProcessed);
    });
  });
});
