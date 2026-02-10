/**
 * Tests for Zod schema validation.
 */

import { describe, it, expect } from '@jest/globals';
import {
  validateVendorInventoryResponse,
  safeValidateVendorInventoryResponse,
  vendorListingRecordSchema,
} from '../inventorySchema';
import {
  createMockVendorResponse,
  createInvalidMockVendorResponse,
  createEmptyMockVendorResponse,
} from './fixtures';

describe('VendorInventoryResponse Schema', () => {
  describe('Schema Validation', () => {
    it('valid vendor response passes validation', () => {
      const response = createMockVendorResponse();
      const result = safeValidateVendorInventoryResponse(response);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('unknown fields are preserved (passthrough works)', () => {
      const response = {
        ...createMockVendorResponse(),
        unknownField: 'should be preserved',
        nested: { alsoPreserved: true },
      };

      const result = validateVendorInventoryResponse(response);

      expect((result as unknown as { unknownField: string }).unknownField).toBe(
        'should be preserved'
      );
    });

    it('unknown fields do not cause validation failure', () => {
      const response = {
        ...createMockVendorResponse(),
        completelyUnknown: { deeply: { nested: 'field' } },
      };

      expect(() => validateVendorInventoryResponse(response)).not.toThrow();
    });
  });

  describe('Type Coercion', () => {
    it('numeric strings coerced to numbers', () => {
      const listing = {
        id: '123',
        price: '100.50',
        quantity: '5',
      };

      const result = vendorListingRecordSchema.parse(listing);

      expect(typeof result.price).toBe('number');
      expect(typeof result.quantity).toBe('number');
    });

    it('boolean strings coerced to booleans', () => {
      const listing = {
        id: '123',
        isActive: 'true',
        active: 'false',
      };

      const result = vendorListingRecordSchema.parse(listing);

      expect(typeof result.isActive).toBe('boolean');
      expect(typeof result.active).toBe('boolean');
    });
  });

  describe('Partial Data', () => {
    it('schema accepts partial listing records', () => {
      const listing = {
        id: '123',
        // Missing most fields
      };

      expect(() => vendorListingRecordSchema.parse(listing)).not.toThrow();
    });

    it('schema validates minimum identity (at least one of id or url)', () => {
      const listingWithoutIdentity = {
        partNumber: 'OEM123',
        // Missing id, url, etc.
      };

      expect(() => vendorListingRecordSchema.parse(listingWithoutIdentity)).toThrow();
    });

    it('schema handles missing optional fields', () => {
      const listing = {
        id: '123',
        // All optional fields missing
      };

      expect(() => vendorListingRecordSchema.parse(listing)).not.toThrow();
    });
  });

  describe('Array Handling', () => {
    it('empty arrays pass validation', () => {
      const listing = {
        id: '123',
        trims: [],
      };

      expect(() => vendorListingRecordSchema.parse(listing)).not.toThrow();
    });

    it('null arrays handled correctly', () => {
      const listing = {
        id: '123',
        trims: null,
      };

      const result = vendorListingRecordSchema.parse(listing);
      expect(result.trims).toBeNull();
    });

    it('multi-item arrays handled correctly', () => {
      const listing = {
        id: '123',
        trims: ['Base', 'Sport', 'Luxury'],
      };

      const result = vendorListingRecordSchema.parse(listing);
      expect(Array.isArray(result.trims)).toBe(true);
      expect(result.trims).toHaveLength(3);
    });
  });

  describe('Edge Cases', () => {
    it('empty response object', () => {
      const response = {};

      const result = safeValidateVendorInventoryResponse(response);
      expect(result.success).toBe(true);
      expect(result.data?.listings).toHaveLength(0);
    });

    it('response with no listings array', () => {
      const response = {
        metadata: 'some data',
      };

      const result = safeValidateVendorInventoryResponse(response);
      expect(result.success).toBe(true);
      expect(result.data?.listings).toHaveLength(0);
    });

    it('handles very large numbers', () => {
      const listing = {
        id: '123',
        price: 999999999999.99,
      };

      expect(() => vendorListingRecordSchema.parse(listing)).not.toThrow();
    });

    it('handles unicode characters', () => {
      const listing = {
        id: '123',
        description: 'Test with émojis 🚗 and 中文',
      };

      expect(() => vendorListingRecordSchema.parse(listing)).not.toThrow();
    });
  });
});
