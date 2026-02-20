/**
 * ConsistencyChecker — validates incoming entity data against existing
 * database state before allowing upserts.
 *
 * Each method compares a single entity type and returns a
 * ConsistencyCheckResult indicating whether the data is:
 * - CONSISTENT (safe to proceed)
 * - FIXED (incoming data was adjusted to match DB)
 * - REJECTED (hard conflict, cannot proceed)
 *
 * The checker is injected into IngestionPersistenceService, making it
 * easy to swap for stricter or more lenient implementations per vendor.
 */

import type Part from '@domain/part/part';
import type Vendor from '@domain/vendor/vendor';
import type { Interchange, InterchangeSystem } from '@domain/interchange/interchange';
import type { PartCategory } from '@domain/part/partCategory';
import type { PartPosition } from '@domain/part/partPosition';
import type { ConsistencyCheckResult } from './consistencyResult';
import type { ExtractedPartCandidate, ExtractedInterchange } from './entityExtractor';

// ─── Interface ───────────────────────────────────────────────────────

export interface ConsistencyChecker {
    /**
     * Verify the vendor exists in the database.
     * A null vendor means REJECTED — cannot ingest without a known vendor.
     */
    checkVendorExists(vendor: Vendor | null): ConsistencyCheckResult;

    /**
     * Compare incoming part metadata against an existing Part.
     *
     * If the part exists in the DB, verify category and position are consistent.
     * - Same category/position → CONSISTENT
     * - Different but mappable (e.g., vendor says "OTHER") → FIXED (use DB values)
     * - Contradictory (e.g., HEADLIGHT vs BUMPER) → REJECTED
     *
     * @param existingPart  The part found in the DB (null if no match).
     * @param incoming      Part metadata from the DTO.
     */
    checkPart(
        existingPart: Part | null,
        incoming: ExtractedPartCandidate,
    ): ConsistencyCheckResult;

    /**
     * The critical interchange consistency check.
     *
     * Rules:
     * 1. If the part already belongs to a different interchange CODE within
     *    the SAME system (e.g., HOLLANDER A vs HOLLANDER B) → REJECTED.
     *    This would corrupt the part mapping graph.
     * 2. If the interchange code exists but belongs to incompatible parts
     *    (very different categories) → REJECTED.
     * 3. Otherwise → CONSISTENT.
     *
     * @param existingPartInterchanges  Interchanges the resolved part already belongs to.
     * @param incoming                  Incoming interchange data from the DTO.
     * @param resolvedPartId            The part ID we resolved for this listing.
     */
    checkInterchange(
        existingPartInterchanges: Interchange[],
        incoming: ExtractedInterchange,
        resolvedPartId: string,
    ): ConsistencyCheckResult;
}

// ─── Default implementation ──────────────────────────────────────────

export class DefaultConsistencyChecker implements ConsistencyChecker {
    // ── Vendor ──────────────────────────────────────────────────────

    checkVendorExists(vendor: Vendor | null): ConsistencyCheckResult {
        if (!vendor) {
            return {
                entity: 'VENDOR',
                verdict: 'REJECTED',
                resolution: 'Vendor not found in database. Cannot ingest listing for an unknown vendor.',
            };
        }

        return {
            entity: 'VENDOR',
            verdict: 'CONSISTENT',
        };
    }

    // ── Part ────────────────────────────────────────────────────────

    checkPart(
        existingPart: Part | null,
        incoming: ExtractedPartCandidate,
    ): ConsistencyCheckResult {
        // No existing part — nothing to check against.
        // The persistence service will create a new part.
        if (!existingPart) {
            return {
                entity: 'PART',
                verdict: 'CONSISTENT',
                resolution: 'No existing part found; new part will be created.',
            };
        }

        // If DTO has no part metadata, we can't compare — use existing as-is.
        if (!incoming.metadata) {
            return {
                entity: 'PART',
                verdict: 'CONSISTENT',
                resolution: 'No incoming part metadata to compare; using existing part.',
            };
        }

        const incomingCategory = incoming.metadata.category;
        const existingCategory = existingPart.category;

        // Exact match — all good.
        if (existingCategory === incomingCategory) {
            return this.checkPartPosition(existingPart, incoming);
        }

        // If the incoming category is OTHER, it's unresolved — fix to use DB value.
        if (incomingCategory === 'OTHER') {
            return {
                entity: 'PART',
                verdict: 'FIXED',
                field: 'category',
                existingValue: existingCategory,
                incomingValue: incomingCategory,
                resolution: `Incoming category "OTHER" overridden by existing "${existingCategory}".`,
            };
        }

        // Genuine category mismatch — hard reject.
        return {
            entity: 'PART',
            verdict: 'REJECTED',
            field: 'category',
            existingValue: existingCategory,
            incomingValue: incomingCategory,
            resolution:
                `Part category mismatch: DB has "${existingCategory}", ` +
                `incoming says "${incomingCategory}". ` +
                `This likely means the part number maps to a different part.`,
        };
    }

    // ── Interchange ─────────────────────────────────────────────────

    checkInterchange(
        existingPartInterchanges: Interchange[],
        incoming: ExtractedInterchange,
        _resolvedPartId: string,
    ): ConsistencyCheckResult {
        // No existing interchanges for this part — safe to add.
        if (existingPartInterchanges.length === 0) {
            return {
                entity: 'INTERCHANGE',
                verdict: 'CONSISTENT',
                resolution: 'Part has no existing interchanges; new interchange will be created.',
            };
        }

        // Check if this part already belongs to a DIFFERENT code in the same system.
        const incomingSystem = incoming.system;
        const incomingCode = incoming.code;

        for (const existing of existingPartInterchanges) {
            if (existing.system === incomingSystem && existing.code !== incomingCode) {
                // HARD REJECT — this would corrupt the part mapping graph.
                return {
                    entity: 'INTERCHANGE',
                    verdict: 'REJECTED',
                    field: 'code',
                    existingValue: `${existing.system}:${existing.code}`,
                    incomingValue: `${incomingSystem}:${incomingCode}`,
                    resolution:
                        `Part already belongs to interchange ${existing.system}:${existing.code}, ` +
                        `but incoming data says ${incomingSystem}:${incomingCode}. ` +
                        `A part cannot belong to two different codes in the same system.`,
                };
            }
        }

        // If the part is already in this exact (system, code), it's idempotent.
        const alreadyMember = existingPartInterchanges.some(
            (ic) => ic.system === incomingSystem && ic.code === incomingCode,
        );

        if (alreadyMember) {
            return {
                entity: 'INTERCHANGE',
                verdict: 'CONSISTENT',
                resolution: 'Part already belongs to this interchange; no-op.',
            };
        }

        // Different system — additive, safe.
        return {
            entity: 'INTERCHANGE',
            verdict: 'CONSISTENT',
            resolution: 'Adding interchange in a system the part does not yet belong to.',
        };
    }

    // ── Private helpers ─────────────────────────────────────────────

    /**
     * Sub-check for part position consistency.
     * Position mismatches are FIXED (use DB value) rather than rejected,
     * since position is less authoritative than category.
     */
    private checkPartPosition(
        existingPart: Part,
        incoming: ExtractedPartCandidate,
    ): ConsistencyCheckResult {
        const incomingPosition = incoming.metadata?.position;
        const existingPosition = existingPart.position;

        // Both undefined or same — consistent.
        if (existingPosition === incomingPosition) {
            return {
                entity: 'PART',
                verdict: 'CONSISTENT',
            };
        }

        // Position mismatch — fixable, use DB value.
        if (existingPosition && incomingPosition && existingPosition !== incomingPosition) {
            return {
                entity: 'PART',
                verdict: 'FIXED',
                field: 'position',
                existingValue: existingPosition,
                incomingValue: incomingPosition,
                resolution: `Position mismatch resolved: using existing "${existingPosition}" instead of incoming "${incomingPosition}".`,
            };
        }

        // One is defined and the other isn't — consistent (the DB will keep its value).
        return {
            entity: 'PART',
            verdict: 'CONSISTENT',
        };
    }
}
