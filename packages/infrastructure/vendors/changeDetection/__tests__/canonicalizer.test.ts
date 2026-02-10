/**
 * Tests for payload canonicalization.
 */

import { describe, it, expect } from '@jest/globals';
import {
  canonicalizePayload,
  computePayloadHash,
  arePayloadsEquivalent,
} from '../canonicalizer';
import { VOLATILE_FIELDS, BUSINESS_IDENTITY_FIELD_HINTS } from '../volatileFieldsConfig';

describe('Canonicalizer', () => {
  describe('Deterministic Output', () => {
    it('same input produces same canonical JSON', () => {
      const payload = { id: '123', price: 100, name: 'Test' };
      const canonical1 = canonicalizePayload(payload);
      const canonical2 = canonicalizePayload(payload);

      expect(canonical1).toBe(canonical2);
    });

    it('different input produces different canonical JSON', () => {
      const payload1 = { id: '123', price: 100 };
      const payload2 = { id: '456', price: 100 };

      const canonical1 = canonicalizePayload(payload1);
      const canonical2 = canonicalizePayload(payload2);

      expect(canonical1).not.toBe(canonical2);
    });
  });

  describe('Volatile Field Removal', () => {
    it('scrape timestamps removed', () => {
      const payload = {
        id: '123',
        price: 100,
        scrapeTimestamp: '2024-01-01T00:00:00Z',
      };

      const canonical = canonicalizePayload(payload);
      expect(canonical).not.toContain('scrapeTimestamp');
    });

    it('request IDs removed', () => {
      const payload = {
        id: '123',
        price: 100,
        requestId: 'req-123',
        correlationId: 'corr-456',
      };

      const canonical = canonicalizePayload(payload);
      expect(canonical).not.toContain('requestId');
      expect(canonical).not.toContain('correlationId');
    });
  });

  describe('Normalization', () => {
    it('string whitespace normalized (trimmed)', () => {
      const payload = {
        id: '123',
        name: '  Test  ',
      };

      const canonical = canonicalizePayload(payload);
      expect(canonical).not.toContain('  Test  ');
      expect(canonical).toContain('Test');
    });

    it('null/undefined fields normalized', () => {
      const payload = {
        id: '123',
        name: 'Test',
        optional: null,
        alsoOptional: undefined,
      };

      const canonical = canonicalizePayload(payload);
      // Null/undefined should be excluded from canonical form
      expect(canonical).not.toContain('optional');
      expect(canonical).not.toContain('alsoOptional');
    });
  });

  describe('Purity / non-mutation', () => {
    it('does not mutate the original payload object', () => {
      const original = {
        id: '123',
        price: 100,
        nested: {
          quantity: 5,
        },
      };

      const clone = JSON.parse(JSON.stringify(original));
      canonicalizePayload(original);

      expect(original).toEqual(clone);
    });
  });

  describe('Business identity hints vs volatile fields', () => {
    it('business identity fields are not treated as volatile', () => {
      for (const field of BUSINESS_IDENTITY_FIELD_HINTS) {
        expect(VOLATILE_FIELDS.has(field)).toBe(false);
      }
    });

    it('business identity fields survive canonicalization', () => {
      const payload = {
        id: '123',
        price: 100,
        quantityAvailable: 5,
        isActive: true,
        condition: 'NEW_OEM',
      };

      const canonical = canonicalizePayload(payload);
      expect(canonical).toContain('price');
      expect(canonical).toContain('quantityAvailable');
      expect(canonical).toContain('isActive');
      expect(canonical).toContain('condition');
    });
  });

  describe('Hash Computation', () => {
    it('computePayloadHash produces consistent hashes', () => {
      const payload = { id: '123', price: 100 };
      const hash1 = computePayloadHash(payload);
      const hash2 = computePayloadHash(payload);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
    });

    it('arePayloadsEquivalent returns true for equivalent payloads', () => {
      const payload1 = { id: '123', price: 100 };
      const payload2 = { id: '123', price: 100 };

      expect(arePayloadsEquivalent(payload1, payload2)).toBe(true);
    });

    it('arePayloadsEquivalent returns false for different payloads', () => {
      const payload1 = { id: '123', price: 100 };
      const payload2 = { id: '456', price: 100 };

      expect(arePayloadsEquivalent(payload1, payload2)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('empty object', () => {
      const payload = {};
      const canonical = canonicalizePayload(payload);
      expect(canonical).toBe('{}');
    });

    it('object with only volatile fields', () => {
      const payload = {
        scrapeTimestamp: '2024-01-01T00:00:00Z',
        requestId: 'req-123',
      };

      const canonical = canonicalizePayload(payload);
      expect(canonical).toBe('{}');
    });

    it('nested objects with volatile fields', () => {
      const payload = {
        id: '123',
        metadata: {
          scrapeTimestamp: '2024-01-01T00:00:00Z',
          requestId: 'req-123',
          actualData: 'preserved',
        },
      };

      const canonical = canonicalizePayload(payload);
      expect(canonical).toContain('actualData');
      expect(canonical).not.toContain('scrapeTimestamp');
      expect(canonical).not.toContain('requestId');
    });
  });
});
