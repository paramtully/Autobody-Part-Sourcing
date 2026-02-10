import { createHash } from 'crypto';
import { VOLATILE_FIELDS } from './volatileFieldsConfig';

/**
 * Canonicalizes a payload object by:
 * - Removing volatile fields (timestamps, request IDs, etc.)
 * - Normalizing numeric/string formatting
 * - Normalizing date formats to ISO strings
 * - Normalizing null/undefined fields
 * - Sorting arrays where order doesn't matter
 * 
 * @param payload - Payload object to canonicalize
 * @returns Canonical JSON string ready for hashing
 */
export function canonicalizePayload(payload: unknown): string {
  // Important: never mutate the original payload. Work on a separate traversal
  // state (the visited set) and construct a new object graph for the canonical form.
  const canonical = canonicalizeValue(payload, new Set());
  return JSON.stringify(canonical, null, 0); // Compact JSON (no whitespace)
}

/**
 * Recursively canonicalize a value.
 * 
 * @param value - Value to canonicalize
 * @param visited - Set of visited objects to prevent circular references
 * @returns Canonicalized value
 */
function canonicalizeValue(value: unknown, visited: Set<object>): unknown {
  // Handle null and undefined
  if (value === null || value === undefined) {
    return null; // Normalize undefined to null
  }

  // Handle primitives
  if (typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    // Normalize whitespace
    const trimmed = value.trim();
    // Try to parse as ISO date and normalize
    const date = tryParseDate(trimmed);
    if (date) {
      return date.toISOString();
    }
    return trimmed;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    // For arrays, we preserve order (order may matter for some fields)
    // But we canonicalize each element
    return value.map((item) => canonicalizeValue(item, visited));
  }

  // Handle objects
  if (typeof value === 'object') {
    // Prevent circular references
    if (visited.has(value)) {
      return '[Circular]';
    }
    visited.add(value);

    const obj = value as Record<string, unknown>;
    const canonical: Record<string, unknown> = {};

    // Sort keys for consistent ordering
    const sortedKeys = Object.keys(obj).sort();

    for (const key of sortedKeys) {
      // Skip volatile fields
      if (VOLATILE_FIELDS.has(key)) {
        continue;
      }

      // Skip null/undefined values
      const val = obj[key];
      if (val === null || val === undefined) {
        continue; // Don't include null/undefined in canonical form
      }

      // Recursively canonicalize value
      canonical[key] = canonicalizeValue(val, visited);
    }

    visited.delete(value);
    return canonical;
  }

  // Fallback for other types
  return value;
}

/**
 * Try to parse a string as a date.
 * Returns Date object if parseable, null otherwise.
 */
function tryParseDate(value: string): Date | null {
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    return date;
  }
  return null;
}

/**
 * Compute SHA-256 hash of canonical payload.
 * 
 * @param payload - Payload object to hash
 * @returns SHA-256 hash as hex string
 */
export function computePayloadHash(payload: unknown): string {
  const canonical = canonicalizePayload(payload);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Check if two payloads are equivalent (have same canonical hash).
 * 
 * @param payload1 - First payload
 * @param payload2 - Second payload
 * @returns True if payloads are equivalent
 */
export function arePayloadsEquivalent(payload1: unknown, payload2: unknown): boolean {
  const hash1 = computePayloadHash(payload1);
  const hash2 = computePayloadHash(payload2);
  return hash1 === hash2;
}
