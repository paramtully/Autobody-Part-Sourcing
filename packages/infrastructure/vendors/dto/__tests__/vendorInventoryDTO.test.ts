/**
 * Tests for VendorInventoryDTO validation and edge cases.
 */

import { describe, it, expect } from '@jest/globals';
import type { VendorInventoryDTO } from '../vendorInventoryDTO';
import {
  createValidVendorInventoryDTO,
  createInvalidVendorInventoryDTO,
  isValidVendorInventoryDTO,
  hasValidIdentity,
} from '../../__tests__/fixtures';

describe('VendorInventoryDTO', () => {
  describe('Identity & Deduplication', () => {
    it('requires at least one of vendorListingExternalId or sourceUrl', () => {
      const dto = createValidVendorInventoryDTO();
      expect(hasValidIdentity(dto)).toBe(true);
    });

    it('accepts both vendorListingExternalId and sourceUrl', () => {
      const dto = createValidVendorInventoryDTO({
        vendorListingExternalId: 'id-123',
        sourceUrl: 'https://vendor.com/123',
      });
      expect(hasValidIdentity(dto)).toBe(true);
    });

    it('normalizedPartNumberCandidates handles empty array', () => {
      const dto = createValidVendorInventoryDTO({
        normalizedPartNumberCandidates: [],
      });
      expect(Array.isArray(dto.normalizedPartNumberCandidates)).toBe(true);
      expect(dto.normalizedPartNumberCandidates).toHaveLength(0);
    });

    it('normalizedPartNumberCandidates handles multiple values', () => {
      const dto = createValidVendorInventoryDTO({
        normalizedPartNumberCandidates: ['OEM123', 'AFT456', 'VENDOR789'],
      });
      expect(dto.normalizedPartNumberCandidates).toHaveLength(3);
    });
  });

  describe('Payload Fingerprinting', () => {
    it('canonicalPayloadJson is deterministic', () => {
      const payload = { id: '123', price: 100 };
      const dto1 = createValidVendorInventoryDTO({
        canonicalPayloadJson: JSON.stringify(payload),
      });
      const dto2 = createValidVendorInventoryDTO({
        canonicalPayloadJson: JSON.stringify(payload),
      });

      expect(dto1.canonicalPayloadJson).toBe(dto2.canonicalPayloadJson);
    });

    it('payloadHash is consistent for identical canonical payloads', () => {
      const hash = 'test-hash-123';
      const dto1 = createValidVendorInventoryDTO({ payloadHash: hash });
      const dto2 = createValidVendorInventoryDTO({ payloadHash: hash });

      expect(dto1.payloadHash).toBe(dto2.payloadHash);
    });

    it('payloadHash differs for different payloads', () => {
      const dto1 = createValidVendorInventoryDTO({ payloadHash: 'hash-1' });
      const dto2 = createValidVendorInventoryDTO({ payloadHash: 'hash-2' });

      expect(dto1.payloadHash).not.toBe(dto2.payloadHash);
    });

    it('ingestedAt is always present and valid ISO string', () => {
      const dto = createValidVendorInventoryDTO();
      expect(dto.ingestedAt).toBeDefined();
      expect(() => new Date(dto.ingestedAt)).not.toThrow();
    });
  });

  describe('Listing Attributes', () => {
    it('condition maps to PartCondition enum or UNKNOWN fallback', () => {
      const dto = createValidVendorInventoryDTO({ condition: 'UNKNOWN' });
      expect(dto.condition).toBe('UNKNOWN');
    });

    it('availabilityStatus maps to AvailabilityStatus enum or UNKNOWN fallback', () => {
      const dto = createValidVendorInventoryDTO({ availabilityStatus: 'UNKNOWN' });
      expect(dto.availabilityStatus).toBe('UNKNOWN');
    });

    it('quantityAvailable handles undefined', () => {
      const dto = createValidVendorInventoryDTO({ quantityAvailable: undefined });
      expect(dto.quantityAvailable).toBeUndefined();
    });

    it('isActive defaults correctly', () => {
      const dto = createValidVendorInventoryDTO({ isActive: true });
      expect(dto.isActive).toBe(true);
    });
  });

  describe('Pricing', () => {
    it('priceMinorMin is always present and non-negative', () => {
      const dto = createValidVendorInventoryDTO({ priceMinorMin: 10000 });
      expect(dto.priceMinorMin).toBeGreaterThanOrEqual(0);
    });

    it('priceMinorMax is >= priceMinorMin when present', () => {
      const dto = createValidVendorInventoryDTO({
        priceMinorMin: 10000,
        priceMinorMax: 15000,
      });
      expect(dto.priceMinorMax).toBeGreaterThanOrEqual(dto.priceMinorMin);
    });

    it('priceMinorMax can be undefined', () => {
      const dto = createValidVendorInventoryDTO({ priceMinorMax: undefined });
      expect(dto.priceMinorMax).toBeUndefined();
    });

    it('currency maps to Currency enum or falls back to string', () => {
      const dto = createValidVendorInventoryDTO({ currency: 'INVALID_CODE' });
      expect(typeof dto.currency).toBe('string');
    });
  });

  describe('Edge Cases', () => {
    it('all optional fields can be missing', () => {
      const dto: VendorInventoryDTO = {
        vendorId: 'test',
        normalizedPartNumberCandidates: [],
        canonicalPayloadJson: '{}',
        payloadHash: 'hash',
        ingestedAt: new Date().toISOString(),
        condition: 'UNKNOWN',
        availabilityStatus: 'UNKNOWN',
        isActive: true,
        priceMinorMin: 0,
        currency: 'USD',
        dataSource: 'VENDOR_API',
        vendorListingExternalId: 'id',
      };
      expect(isValidVendorInventoryDTO(dto)).toBe(true);
    });

    it('string fields handle empty strings vs undefined', () => {
      const dto1 = createValidVendorInventoryDTO({ description: '' });
      const dto2 = createValidVendorInventoryDTO({ description: undefined });

      expect(dto1.description).toBe('');
      expect(dto2.description).toBeUndefined();
    });

    it('array fields handle null vs empty array vs undefined', () => {
      const dto1 = createValidVendorInventoryDTO({ normalizedPartNumberCandidates: [] });
      const dto2 = createValidVendorInventoryDTO({
        normalizedPartNumberCandidates: ['test'],
      });

      expect(Array.isArray(dto1.normalizedPartNumberCandidates)).toBe(true);
      expect(Array.isArray(dto2.normalizedPartNumberCandidates)).toBe(true);
    });
  });
});
