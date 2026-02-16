/**
 * Unit tests for DTO Mapper and Data Cleaner.
 * 
 * Tests cover:
 * - DTO mapping from vendor records
 * - Field extraction and normalization
 * - Condition and availability mapping
 * - Price conversion
 * - Data cleaning and validation
 * - Error detection and warnings
 * - Edge cases
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { DefaultDTOMapper, type DTOMapper } from '../../dto/dtoMapper';
import { DefaultDataCleaner, type DataCleaner } from '../dataCleaner';
import type { VendorInventoryDTO } from '../../dto/vendorInventoryDTO';
import type { VendorListingRecord } from '../../inventorySchema';
import type { CleanedDTO } from '../cleanedDTO';
import type { ValidationResult } from '../validationResult';

describe('DefaultDTOMapper', () => {
  let mapper: DTOMapper;
  const vendorId = 'test-vendor';
  const ingestedAt = '2026-02-13T12:00:00Z';

  beforeEach(() => {
    mapper = new DefaultDTOMapper();
  });

  describe('Basic Mapping', () => {
    it('maps minimal valid record', () => {
      const record: VendorListingRecord = {
        id: 'listing-123',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.vendorId).toBe(vendorId);
      expect(dto.vendorListingExternalId).toBe('listing-123');
      expect(dto.ingestedAt).toBe(ingestedAt);
      expect(dto.payloadHash).toBeDefined();
    });

    it('maps complete record with all fields', () => {
      const record: VendorListingRecord = {
        id: 'listing-123',
        partNumber: 'OEM-456',
        oemPartNumber: 'OEM-456',
        condition: 'NEW_OEM',
        price: 99.99,
        currency: 'USD',
        quantity: 5,
        availability: 'IN_STOCK',
        description: 'Front bumper',
        make: 'Toyota',
        model: 'Camry',
        yearFrom: 2018,
        yearTo: 2023,
        url: 'https://vendor.com/listing/123',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.vendorListingExternalId).toBe('listing-123');
      expect(dto.normalizedPartNumberCandidates).toEqual(['OEM-456']);
      expect(dto.condition).toBe('NEW_OEM');
      expect(dto.priceMinorMin).toBe(9999); // $99.99 in cents
      expect(dto.currency).toBe('USD');
      expect(dto.quantityAvailable).toBe(5);
      expect(dto.availabilityStatus).toBe('IN_STOCK');
      expect(dto.description).toBe('Front bumper');
      expect(dto.fitment).toEqual({
        make: 'Toyota',
        model: 'Camry',
        yearFrom: 2018,
        yearTo: 2023,
        trims: undefined,
        rawFitmentText: undefined,
      });
    });

    it('generates canonical payload JSON and hash', () => {
      const record: VendorListingRecord = {
        id: 'listing-123',
        price: 100,
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.canonicalPayloadJson).toBeDefined();
      expect(dto.payloadHash).toBeDefined();
      expect(dto.payloadHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });
  });

  describe('Identity Extraction', () => {
    it('prefers vendorListingId over other IDs', () => {
      const record: VendorListingRecord = {
        id: 'generic-id',
        listingId: 'listing-id',
        vendorListingId: 'vendor-listing-id',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.vendorListingExternalId).toBe('vendor-listing-id');
    });

    it('falls back to listingId if vendorListingId missing', () => {
      const record: VendorListingRecord = {
        id: 'generic-id',
        listingId: 'listing-id',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.vendorListingExternalId).toBe('listing-id');
    });

    it('uses id as last resort', () => {
      const record: VendorListingRecord = {
        id: 'generic-id',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.vendorListingExternalId).toBe('generic-id');
    });

    it('extracts sourceUrl from url field', () => {
      const record: VendorListingRecord = {
        id: 'listing-123',
        url: 'https://vendor.com/part/123',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.sourceUrl).toBe('https://vendor.com/part/123');
    });

    it('prefers sourceUrl over url', () => {
      const record: VendorListingRecord = {
        id: 'listing-123',
        url: 'https://vendor.com/generic',
        sourceUrl: 'https://vendor.com/specific',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.sourceUrl).toBe('https://vendor.com/specific');
    });
  });

  describe('Part Number Extraction', () => {
    it('extracts OEM part number', () => {
      const record: VendorListingRecord = {
        id: 'listing-123',
        oemPartNumber: 'OEM-456',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.normalizedPartNumberCandidates).toEqual(['OEM-456']);
    });

    it('extracts multiple part number candidates', () => {
      const record: VendorListingRecord = {
        id: 'listing-123',
        oemPartNumber: 'OEM-456',
        partNumber: 'GENERIC-789',
        aftermarketPartNumber: 'AFT-012',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.normalizedPartNumberCandidates).toEqual([
        'OEM-456',
        'GENERIC-789',
        'AFT-012',
      ]);
    });

    it('deduplicates identical part numbers', () => {
      const record: VendorListingRecord = {
        id: 'listing-123',
        oemPartNumber: 'SAME-123',
        partNumber: 'SAME-123',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.normalizedPartNumberCandidates).toEqual(['SAME-123']);
    });

    it('returns empty array when no part numbers', () => {
      const record: VendorListingRecord = {
        id: 'listing-123',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.normalizedPartNumberCandidates).toEqual([]);
    });
  });

  describe('Condition Mapping', () => {
    it('maps standard conditions correctly', () => {
      const conditions: Record<string, string> = {
        'NEW_OEM': 'NEW_OEM',
        'NEW OEM': 'NEW_OEM',
        'OEM': 'NEW_OEM',
        'NEW_AFTERMARKET': 'NEW_AFTERMARKET',
        'AFTERMARKET': 'NEW_AFTERMARKET',
        'RECYCLED': 'RECYCLED',
        'USED': 'RECYCLED',
        'SALVAGE': 'RECYCLED',
        'REMANUFACTURED': 'REMANUFACTURED',
        'REMAN': 'REMANUFACTURED',
        'RECONDITIONED': 'RECONDITIONED',
        'REFURBISHED': 'RECONDITIONED',
      };

      Object.entries(conditions).forEach(([input, expected]) => {
        const record: VendorListingRecord = { id: '1', condition: input };
        const dto = mapper.map(record, vendorId, ingestedAt);
        expect(dto.condition).toBe(expected);
      });
    });

    it('handles case-insensitive conditions', () => {
      const record: VendorListingRecord = { id: '1', condition: 'new oem' };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.condition).toBe('NEW_OEM');
    });

    it('maps unknown condition to UNKNOWN', () => {
      const record: VendorListingRecord = { id: '1', condition: 'custom-condition' };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.condition).toBe('UNKNOWN');
    });

    it('handles null/undefined condition', () => {
      const record: VendorListingRecord = { id: '1', condition: null };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.condition).toBe('UNKNOWN');
    });
  });

  describe('Availability Mapping', () => {
    it('maps standard availability statuses', () => {
      const statuses: Record<string, string> = {
        'IN_STOCK': 'IN_STOCK',
        'IN STOCK': 'IN_STOCK',
        'AVAILABLE': 'IN_STOCK',
        'LOW_STOCK': 'LOW_STOCK',
        'LIMITED': 'LOW_STOCK',
        'BACKORDER': 'BACKORDER',
        'BACKORDERED': 'BACKORDER',
        'SPECIAL_ORDER': 'SPECIAL_ORDER',
      };

      Object.entries(statuses).forEach(([input, expected]) => {
        const record: VendorListingRecord = { id: '1', availability: input };
        const dto = mapper.map(record, vendorId, ingestedAt);
        expect(dto.availabilityStatus).toBe(expected);
      });
    });

    it('infers availability from quantity', () => {
      const cases = [
        { quantity: 0, expected: 'BACKORDER' },
        { quantity: 1, expected: 'LOW_STOCK' },
        { quantity: 2, expected: 'LOW_STOCK' },
        { quantity: 3, expected: 'IN_STOCK' },
        { quantity: 100, expected: 'IN_STOCK' },
      ];

      cases.forEach(({ quantity, expected }) => {
        const record: VendorListingRecord = { id: '1', quantity };
        const dto = mapper.map(record, vendorId, ingestedAt);
        expect(dto.availabilityStatus).toBe(expected);
      });
    });

    it('prefers explicit availability over quantity inference', () => {
      const record: VendorListingRecord = {
        id: '1',
        availability: 'IN_STOCK',
        quantity: 0, // Would normally infer BACKORDER
      };

      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.availabilityStatus).toBe('IN_STOCK');
    });

    it('returns UNKNOWN when no availability info', () => {
      const record: VendorListingRecord = { id: '1' };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.availabilityStatus).toBe('UNKNOWN');
    });
  });

  describe('Price Conversion', () => {
    it('converts price to minor units (cents)', () => {
      const cases = [
        { price: 0, expected: 0 },
        { price: 1, expected: 100 },
        { price: 9.99, expected: 999 },
        { price: 100.50, expected: 10050 },
        { price: 1234.56, expected: 123456 },
      ];

      cases.forEach(({ price, expected }) => {
        const record: VendorListingRecord = { id: '1', price };
        const dto = mapper.map(record, vendorId, ingestedAt);
        expect(dto.priceMinorMin).toBe(expected);
      });
    });

    it('rounds fractional cents', () => {
      const record: VendorListingRecord = { id: '1', price: 9.995 };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.priceMinorMin).toBe(1000); // Rounds to $10.00
    });

    it('handles null/undefined price as zero', () => {
      const record: VendorListingRecord = { id: '1', price: null };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.priceMinorMin).toBe(0);
    });

    it('maps priceMax when provided', () => {
      const record: VendorListingRecord = { id: '1', price: 100, priceMax: 150 };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.priceMinorMin).toBe(10000);
      expect(dto.priceMinorMax).toBe(15000);
    });

    it('defaults to USD currency', () => {
      const record: VendorListingRecord = { id: '1', price: 100 };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.currency).toBe('USD');
    });

    it('normalizes currency to uppercase', () => {
      const record: VendorListingRecord = { id: '1', price: 100, currency: 'cad' };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.currency).toBe('CAD');
    });
  });

  describe('Fitment Extraction', () => {
    it('extracts complete fitment information', () => {
      const record: VendorListingRecord = {
        id: '1',
        make: 'Honda',
        model: 'Accord',
        yearFrom: 2015,
        yearTo: 2020,
        trim: 'EX-L',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.fitment).toEqual({
        make: 'Honda',
        model: 'Accord',
        yearFrom: 2015,
        yearTo: 2020,
        trims: ['EX-L'],
        rawFitmentText: undefined,
      });
    });

    it('returns undefined when no fitment data', () => {
      const record: VendorListingRecord = { id: '1' };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.fitment).toBeUndefined();
    });
  });

  describe('Warehouse Location Extraction', () => {
    it('extracts location components', () => {
      const record: VendorListingRecord = {
        id: '1',
        state: 'CA',
        city: 'Los Angeles',
        postalCode: '90001',
        country: 'US',
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.warehouseLocation).toEqual({
        country: 'US',
        stateOrProvince: 'CA',
        city: 'Los Angeles',
        postalCode: '90001',
        rawLocationText: undefined,
      });
    });

    it('defaults to US when country not provided', () => {
      const record: VendorListingRecord = { id: '1', state: 'NY' };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.warehouseLocation?.country).toBe('US');
    });

    it('returns undefined when no location data', () => {
      const record: VendorListingRecord = { id: '1' };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.warehouseLocation).toBeUndefined();
    });
  });

  describe('Image Extraction', () => {
    it('extracts image array', () => {
      const record: VendorListingRecord = {
        id: '1',
        images: [
          { url: 'https://example.com/img1.jpg' },
          { url: 'https://example.com/img2.jpg', type: 'DETAIL' },
        ],
      };

      const dto = mapper.map(record, vendorId, ingestedAt);

      expect(dto.images).toHaveLength(2);
      expect(dto.images![0]).toEqual({
        url: 'https://example.com/img1.jpg',
        imageType: 'PRIMARY', // First image defaults to PRIMARY
        sortOrder: 0,
      });
      expect(dto.images![1]).toEqual({
        url: 'https://example.com/img2.jpg',
        imageType: 'DETAIL',
        sortOrder: 1,
      });
    });

    it('returns undefined when no images', () => {
      const record: VendorListingRecord = { id: '1' };
      const dto = mapper.map(record, vendorId, ingestedAt);
      expect(dto.images).toBeUndefined();
    });
  });
});

describe('DefaultDataCleaner', () => {
  let cleaner: DataCleaner;

  beforeEach(() => {
    cleaner = new DefaultDataCleaner();
  });

  const createValidDTO = (overrides?: Partial<VendorInventoryDTO>): VendorInventoryDTO => ({
    vendorId: 'test-vendor',
    vendorListingExternalId: 'listing-123',
    sourceUrl: 'https://vendor.com/listing/123',
    normalizedPartNumberCandidates: ['OEM-456'],
    canonicalPayloadJson: '{}',
    payloadHash: 'abc123',
    ingestedAt: '2026-02-13T12:00:00Z',
    condition: 'NEW_OEM',
    availabilityStatus: 'IN_STOCK',
    isActive: true,
    priceMinorMin: 10000,
    currency: 'USD',
    dataSource: 'VENDOR_API',
    ...overrides,
  });

  describe('Valid DTO Cleaning', () => {
    it('marks valid DTO as cleaned', () => {
      const dto = createValidDTO();
      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data).toBeDefined();
        expect(result.warnings).toEqual([]);
      }
    });

    it('trims string fields', () => {
      const dto = createValidDTO({
        vendorListingExternalId: '  listing-123  ',
        description: '  Front bumper  ',
        normalizedPartNumberCandidates: ['  OEM-456  ', '  AFT-789  '],
      });

      const result = cleaner.clean(dto);

      if (result.valid) {
        expect(result.data.vendorListingExternalId).toBe('listing-123');
        expect(result.data.description).toBe('Front bumper');
        expect(result.data.normalizedPartNumberCandidates).toEqual(['OEM-456', 'AFT-789']);
      }
    });

    it('removes empty part numbers after trimming', () => {
      const dto = createValidDTO({
        normalizedPartNumberCandidates: ['OEM-456', '   ', 'AFT-789', ''],
      });

      const result = cleaner.clean(dto);

      if (result.valid) {
        expect(result.data.normalizedPartNumberCandidates).toEqual(['OEM-456', 'AFT-789']);
      }
    });
  });

  describe('Identity Validation', () => {
    it('fails when no identity fields present', () => {
      const dto = createValidDTO({
        vendorListingExternalId: undefined,
        sourceUrl: undefined,
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].code).toBe('MISSING_IDENTITY');
      }
    });

    it('passes when vendorListingExternalId present', () => {
      const dto = createValidDTO({
        vendorListingExternalId: 'listing-123',
        sourceUrl: undefined,
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
    });

    it('passes when sourceUrl present', () => {
      const dto = createValidDTO({
        vendorListingExternalId: undefined,
        sourceUrl: 'https://vendor.com/listing/123',
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
    });
  });

  describe('Part Number Validation', () => {
    it('warns when no part number candidates', () => {
      const dto = createValidDTO({
        normalizedPartNumberCandidates: [],
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].code).toBe('MISSING_PART_NUMBER');
      }
    });

    it('passes when part numbers present', () => {
      const dto = createValidDTO({
        normalizedPartNumberCandidates: ['OEM-456'],
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.warnings).not.toContainEqual(
          expect.objectContaining({ code: 'MISSING_PART_NUMBER' })
        );
      }
    });
  });

  describe('Price Validation', () => {
    it('fails on negative price', () => {
      const dto = createValidDTO({
        priceMinorMin: -1000,
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].code).toBe('NEGATIVE_PRICE');
      }
    });

    it('warns on zero price', () => {
      const dto = createValidDTO({
        priceMinorMin: 0,
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.warnings[0].code).toBe('ZERO_PRICE');
      }
    });

    it('warns on unreasonably high price', () => {
      const dto = createValidDTO({
        priceMinorMin: 200_000_000, // $2 million
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.warnings).toContainEqual(
          expect.objectContaining({ code: 'OUT_OF_RANGE', field: 'priceMinorMin' })
        );
      }
    });

    it('swaps min and max when reversed', () => {
      const dto = createValidDTO({
        priceMinorMin: 20000,
        priceMinorMax: 10000,
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.priceMinorMin).toBe(10000);
        expect(result.data.priceMinorMax).toBe(20000);
        expect(result.warnings).toContainEqual(
          expect.objectContaining({ code: 'OUT_OF_RANGE', field: 'priceMinorMax' })
        );
      }
    });
  });

  describe('Condition and Availability Warnings', () => {
    it('warns on UNKNOWN condition', () => {
      const dto = createValidDTO({
        condition: 'UNKNOWN',
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.warnings).toContainEqual(
          expect.objectContaining({ code: 'UNKNOWN_CONDITION' })
        );
      }
    });

    it('warns on UNKNOWN availability', () => {
      const dto = createValidDTO({
        availabilityStatus: 'UNKNOWN',
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.warnings).toContainEqual(
          expect.objectContaining({ code: 'UNKNOWN_AVAILABILITY' })
        );
      }
    });
  });

  describe('Year Range Validation', () => {
    it('swaps yearFrom and yearTo when reversed', () => {
      const dto = createValidDTO({
        fitment: {
          make: 'Toyota',
          model: 'Camry',
          yearFrom: 2023,
          yearTo: 2018,
        },
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.fitment?.yearFrom).toBe(2018);
        expect(result.data.fitment?.yearTo).toBe(2023);
        expect(result.warnings).toContainEqual(
          expect.objectContaining({ code: 'INVALID_YEAR_RANGE' })
        );
      }
    });

    it('fails on year before minimum (1900)', () => {
      const dto = createValidDTO({
        fitment: {
          make: 'Antique',
          model: 'Car',
          yearFrom: 1899,
        },
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({ code: 'OUT_OF_RANGE', field: 'fitment.yearFrom' })
        );
      }
    });

    it('fails on year beyond maximum future', () => {
      const dto = createValidDTO({
        fitment: {
          make: 'Future',
          model: 'Car',
          yearFrom: 2099,
        },
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({ code: 'OUT_OF_RANGE', field: 'fitment.yearFrom' })
        );
      }
    });
  });

  describe('Timestamp Validation', () => {
    it('removes invalid timestamp and warns', () => {
      const dto = createValidDTO({
        vendorUpdatedAt: 'not-a-date',
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.vendorUpdatedAt).toBeUndefined();
        expect(result.warnings).toContainEqual(
          expect.objectContaining({ code: 'INVALID_FORMAT', field: 'vendorUpdatedAt' })
        );
      }
    });

    it('keeps valid timestamp', () => {
      const dto = createValidDTO({
        vendorUpdatedAt: '2026-02-13T12:00:00Z',
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.vendorUpdatedAt).toBe('2026-02-13T12:00:00Z');
      }
    });
  });

  describe('Image URL Validation', () => {
    it('removes invalid image URLs', () => {
      const dto = createValidDTO({
        images: [
          { url: 'https://example.com/valid.jpg', sortOrder: 0 },
          { url: 'not-a-url', sortOrder: 1 },
          { url: 'https://example.com/also-valid.jpg', sortOrder: 2 },
        ],
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.images).toHaveLength(2);
        expect(result.data.images![0].url).toBe('https://example.com/valid.jpg');
        expect(result.data.images![1].url).toBe('https://example.com/also-valid.jpg');
        expect(result.warnings).toContainEqual(
          expect.objectContaining({ code: 'INVALID_URL' })
        );
      }
    });
  });

  describe('Error Accumulation', () => {
    it('accumulates multiple errors', () => {
      const dto = createValidDTO({
        vendorListingExternalId: undefined,
        sourceUrl: undefined,
        priceMinorMin: -1000,
        fitment: {
          yearFrom: 1899,
        },
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('accumulates multiple warnings', () => {
      const dto = createValidDTO({
        priceMinorMin: 0,
        normalizedPartNumberCandidates: [],
        condition: 'UNKNOWN',
        availabilityStatus: 'UNKNOWN',
      });

      const result = cleaner.clean(dto);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.warnings.length).toBeGreaterThanOrEqual(4);
      }
    });
  });
});
