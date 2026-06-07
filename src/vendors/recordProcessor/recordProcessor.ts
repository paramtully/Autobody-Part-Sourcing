import { VendorRecord, Fitment, normalizeVendorRecord } from "../clients/vendorRecord";
import { db, parts, partIdentifiers, fitments, partFitments, listings, listingImages, warehouseLocations } from "@repo/db";
import { inArray, and, eq, sql } from "drizzle-orm";

export interface BatchResult {
  succeeded: number;
  failed: number;
  skipped: number;
  newParts: Array<{ partId: string; vendorListingExternalId: string }>;
}

interface ResolvedRecord {
    record: VendorRecord;
    partIds: Set<string>;
    partIdentifierId: string;       // empty string if isNew
    isValid: boolean;
    isNew: boolean;
    confidence?: number;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFAULT_TX_CHUNK = 40;
const DEFAULT_ENRICHMENT_CHUNK = 10;

function txChunkSize(): number {
    const n = Number(process.env['INGEST_TX_CHUNK_SIZE'] ?? DEFAULT_TX_CHUNK);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TX_CHUNK;
}

function enrichmentChunkSize(): number {
    const n = Number(process.env['INGEST_ENRICHMENT_CHUNK_SIZE'] ?? DEFAULT_ENRICHMENT_CHUNK);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_ENRICHMENT_CHUNK;
}

// validates records and upserts safe records to db
export interface RecordProcessor {
    validateAndUpsert(records: VendorRecord[], vendorId: string): Promise<BatchResult>;
    appendFitmentsToParts(enrichments: Array<{ partId: string; fitments: Fitment[] }>): Promise<void>;
}


// implements record processor for drizzle Postgres SQL
export default class DrizzleRecordProcessor implements RecordProcessor {

    async validateAndUpsert(records: VendorRecord[], vendorId: string): Promise<BatchResult> {
        records = records.map(normalizeVendorRecord);
        if (records.length === 0) {
            return { succeeded: 0, failed: 0, skipped: 0, newParts: [] };
        }

        let [valueToPartIds, valueToPartIdentifierId] = await this.getExistingPartIdentifierMappings(records);

        // Pre-resolve all page fitments once — avoids repeating upserts in each write chunk.
        const fitmentKeyToId = await this.preResolveFitments(records);

        let succeeded = 0;
        let failed = 0;
        let skipped = 0;
        const newParts: BatchResult['newParts'] = [];
        const warehouseLocationCache = new Map<string, string>();
        const chunkSize = txChunkSize();

        for (let i = 0; i < records.length; i += chunkSize) {
            const chunkRecords = records.slice(i, i + chunkSize);
            const [newRecords, existingRecords, conflictRecords] =
                this.validateRecords(chunkRecords, valueToPartIds, valueToPartIdentifierId);
            skipped += conflictRecords.length;

            const newPartGroups = this.getNewPartGroups(newRecords);
            const writableCount = chunkRecords.length - conflictRecords.length;
            if (writableCount === 0) continue;

            try {
                const chunkResult = await db.transaction(async (tx) =>
                    this.upsertChunk(tx, {
                        vendorId,
                        newPartGroups,
                        existingRecords,
                        valueToPartIds,
                        fitmentKeyToId,
                        warehouseLocationCache,
                    }),
                );
                succeeded += chunkResult.succeeded;
                failed += chunkResult.failed;
                newParts.push(...chunkResult.newParts);
            } catch (e: unknown) {
                failed += writableCount;
                console.error(
                    `[recordProcessor] chunk ${Math.floor(i / chunkSize) + 1} failed (${writableCount} records):`,
                    e instanceof Error ? e.message : e,
                );
            }

            const [freshIds, freshPI] = await this.getExistingPartIdentifierMappings(chunkRecords);
            this.mergeIdentifierMappings(valueToPartIds, valueToPartIdentifierId, freshIds, freshPI);
        }

        return { succeeded, failed, skipped, newParts };
    }

    /**
     * Appends fitments to already-inserted parts. Called after validateAndUpsert when
     * the pipeline has fetched enrichment data (e.g. Trading API) for new parts only.
     */
    async appendFitmentsToParts(enrichments: Array<{ partId: string; fitments: Fitment[] }>): Promise<void> {
        if (enrichments.length === 0) return;

        const pseudoRecords: VendorRecord[] = enrichments.map(e => ({
            part: { name: '_enrich', category: 'OTHER' },
            identifiers: [{ type: 'INTERCHANGE', value: e.partId }],
            fitments: e.fitments,
            listing: {
                vendorListingExternalId: e.partId,
                condition: 'UNKNOWN',
                availabilityStatus: 'UNKNOWN',
                priceMinorMin: 0,
                currency: 'USD',
            },
        }));

        const fitmentKeyToId = await this.preResolveFitments(pseudoRecords);
        const chunkSize = enrichmentChunkSize();

        for (let i = 0; i < enrichments.length; i += chunkSize) {
            const slice = enrichments.slice(i, i + chunkSize);
            await db.transaction(async (tx) => {
                const pairs: Array<{ partId: string; fitmentId: string }> = [];
                for (const { partId, fitments: pFitments } of slice) {
                    const seen = new Set<string>();
                    for (const f of pFitments) {
                        const fitmentId = fitmentKeyToId.get(this.fitmentKey(f));
                        if (!fitmentId || seen.has(fitmentId)) continue;
                        seen.add(fitmentId);
                        pairs.push({ partId, fitmentId });
                    }
                }
                if (pairs.length === 0) return;
                const dedupedPairs = this.dedupePartFitmentPairs(pairs);
                const PAIR_CHUNK = 30_000;
                for (let j = 0; j < dedupedPairs.length; j += PAIR_CHUNK) {
                    await tx.insert(partFitments).values(dedupedPairs.slice(j, j + PAIR_CHUNK)).onConflictDoNothing();
                }
            });
        }
    }

    /** One short tx: prefetch + insert missing fitment rows for the whole page. */
    private async preResolveFitments(records: VendorRecord[]): Promise<Map<string, string>> {
        const fitmentKeyToId = new Map<string, string>();
        const allFitments = records.flatMap(r => r.fitments);
        if (allFitments.length === 0) return fitmentKeyToId;

        const asResolved: ResolvedRecord[] = records.map(record => ({
            record,
            partIds: new Set<string>(),
            partIdentifierId: '',
            isValid: true,
            isNew: true,
        }));

        await db.transaction(async (tx) => {
            const prefetched = await this.getFitmentMappings(records, tx);
            for (const [k, v] of prefetched) fitmentKeyToId.set(k, v);
            await this.bulkResolveFitments(tx, asResolved, fitmentKeyToId);
        });

        return fitmentKeyToId;
    }

    private async upsertChunk(
        tx: Tx,
        opts: {
            vendorId: string;
            newPartGroups: Map<string, ResolvedRecord[]>;
            existingRecords: ResolvedRecord[];
            valueToPartIds: Map<string, Set<string>>;
            fitmentKeyToId: Map<string, string>;
            warehouseLocationCache: Map<string, string>;
        },
    ): Promise<{ succeeded: number; failed: number; newParts: BatchResult['newParts'] }> {
        const {
            vendorId,
            newPartGroups,
            existingRecords,
            valueToPartIds,
            fitmentKeyToId,
            warehouseLocationCache,
        } = opts;

        let succeeded = 0;
        let failed = 0;
        const newParts: BatchResult['newParts'] = [];
        const partFitmentPairs: Array<{ partId: string; fitmentId: string }> = [];
        type ListingQueueItem = { partIdentifierId: string; record: VendorRecord; confidence: number };
        const listingQueue: ListingQueueItem[] = [];

        for (const [, group] of newPartGroups) {
            const rep = group[0].record.part;

            const [newPart] = await tx
                .insert(parts)
                .values({
                    name: rep.name.slice(0, 255),
                    category: rep.category as typeof parts.$inferInsert['category'],
                    position: (rep.position?.trim() || null) as typeof parts.$inferInsert['position'],
                    description: rep.description ?? null,
                    weightGrams: rep.weightGrams ?? null,
                })
                .onConflictDoUpdate({ target: [parts.name, parts.category], set: { updatedAt: sql`now()` } })
                .returning({ id: parts.id });

            const groupFitmentKeys = new Set<string>();
            for (const r of group) {
                for (const f of r.record.fitments) {
                    const key = this.fitmentKey(f);
                    if (groupFitmentKeys.has(key)) continue;
                    groupFitmentKeys.add(key);
                    const fitmentId = fitmentKeyToId.get(key);
                    if (fitmentId) partFitmentPairs.push({ partId: newPart.id, fitmentId });
                }
            }

            for (const r of group) {
                const insertedPIs = await tx
                    .insert(partIdentifiers)
                    .values(r.record.identifiers.map(i => ({
                        partId: newPart.id,
                        type: i.type,
                        value: i.value,
                        manufacturer: i.manufacturer ?? null,
                        certification: (i.certification ?? null) as typeof partIdentifiers.$inferInsert['certification'],
                    })))
                    .onConflictDoNothing()
                    .returning({ id: partIdentifiers.id });

                const piId = insertedPIs[0]?.id;
                if (!piId) { failed++; continue; }
                listingQueue.push({ partIdentifierId: piId, record: r.record, confidence: r.confidence ?? 0.5 });
                newParts.push({ partId: newPart.id, vendorListingExternalId: r.record.listing.vendorListingExternalId });
            }
        }

        for (const r of existingRecords) {
            const partId = [...r.partIds][0];
            const p = r.record.part;
            const position = p.position?.trim() || undefined;
            if (p.description || p.weightGrams || position) {
                await tx.update(parts).set({
                    ...(p.description && { description: p.description }),
                    ...(p.weightGrams  && { weightGrams: p.weightGrams }),
                    ...(position      && { position: position as typeof parts.$inferInsert['position'] }),
                }).where(eq(parts.id, partId));
            }

            const newIdentifiers = r.record.identifiers.filter(i => !(valueToPartIds.get(i.value)?.has(partId)));
            if (newIdentifiers.length > 0) {
                await tx
                    .insert(partIdentifiers)
                    .values(newIdentifiers.map(i => ({
                        partId,
                        type: i.type,
                        value: i.value,
                        manufacturer: i.manufacturer ?? null,
                        certification: (i.certification ?? null) as typeof partIdentifiers.$inferInsert['certification'],
                    })))
                    .onConflictDoNothing();
            }

            for (const f of r.record.fitments) {
                const fitmentId = fitmentKeyToId.get(this.fitmentKey(f));
                if (fitmentId) partFitmentPairs.push({ partId, fitmentId });
            }

            listingQueue.push({ partIdentifierId: r.partIdentifierId, record: r.record, confidence: r.confidence ?? 0.9 });
        }

        if (partFitmentPairs.length > 0) {
            const dedupedPairs = this.dedupePartFitmentPairs(partFitmentPairs);
            const PAIR_CHUNK = 30_000;
            for (let i = 0; i < dedupedPairs.length; i += PAIR_CHUNK) {
                await tx.insert(partFitments).values(dedupedPairs.slice(i, i + PAIR_CHUNK)).onConflictDoNothing();
            }
        }

        const now = new Date();
        type ImageRow = { url: string; listingId: string; imageType: string | null; sortOrder: number };
        const imageQueue: ImageRow[] = [];

        for (const { partIdentifierId, record, confidence } of listingQueue) {
            if (!partIdentifierId) { failed++; continue; }
            const l = record.listing;

            const warehouseLocationId = l.warehouseLocation
                ? await this.getOrCreateWarehouseLocation(tx, l.warehouseLocation, warehouseLocationCache)
                : undefined;

            const [row] = await tx
                .insert(listings)
                .values({
                    vendorId,
                    partIdentifierId,
                    vendorListingExternalId: l.vendorListingExternalId,
                    sourceUrl: l.sourceUrl,
                    condition: l.condition,
                    description: l.description,
                    quantityAvailable: l.quantityAvailable,
                    availabilityStatus: l.availabilityStatus,
                    priceMinorMin: l.priceMinorMin,
                    priceMinorMax: l.priceMinorMax,
                    currency: l.currency as typeof listings.$inferInsert['currency'],
                    sourceVehicleVin: l.sourceVehicleVin,
                    sourceMileage: l.sourceMileage,
                    sourceDamageType: l.sourceDamageType,
                    estimatedShipTimeHours: l.estimatedShipTimeHours,
                    warehouseLocationId: warehouseLocationId ?? null,
                    confidenceScore: confidence.toString(),
                    source: 'VENDOR_API',
                    rawPayload: record.rawPayload ?? null,
                    lastSeenAt: now,
                    lastVerifiedAt: now,
                })
                .onConflictDoUpdate({
                    target: [listings.vendorId, listings.vendorListingExternalId],
                    set: {
                        partIdentifierId,
                        description: l.description,
                        availabilityStatus: l.availabilityStatus,
                        priceMinorMin: l.priceMinorMin,
                        priceMinorMax: l.priceMinorMax,
                        quantityAvailable: l.quantityAvailable,
                        estimatedShipTimeHours: l.estimatedShipTimeHours,
                        warehouseLocationId: warehouseLocationId ?? null,
                        sourceVehicleVin: l.sourceVehicleVin,
                        sourceDamageType: l.sourceDamageType,
                        confidenceScore: confidence.toString(),
                        rawPayload: record.rawPayload ?? null,
                        isActive: true,
                        lastSeenAt: now,
                        lastVerifiedAt: now,
                        updatedAt: now,
                    },
                })
                .returning({ listingId: listings.id });

            if (l.images?.length) {
                imageQueue.push(...l.images.map((img, idx) => ({
                    url: img.url,
                    listingId: row.listingId,
                    imageType: img.type ?? null,
                    sortOrder: idx,
                })));
            }
            succeeded++;
        }

        if (imageQueue.length > 0) {
            await tx.insert(listingImages).values(imageQueue).onConflictDoNothing();
        }

        return { succeeded, failed, newParts };
    }

    private mergeIdentifierMappings(
        valueToPartIds: Map<string, Set<string>>,
        valueToPartIdentifierId: Map<string, string>,
        freshIds: Map<string, Set<string>>,
        freshPI: Map<string, string>,
    ): void {
        for (const [value, partIds] of freshIds) {
            if (!valueToPartIds.has(value)) valueToPartIds.set(value, new Set());
            for (const id of partIds) valueToPartIds.get(value)!.add(id);
        }
        for (const [value, piId] of freshPI) {
            if (!valueToPartIdentifierId.has(value)) valueToPartIdentifierId.set(value, piId);
        }
    }

    // Phase 1a: bulk-fetch existing partIdentifiers for all identifier values in the batch
    private async getExistingPartIdentifierMappings(records: VendorRecord[]): Promise<[Map<string, Set<string>>, Map<string, string>]> {
        const valueToPartIds: Map<string, Set<string>> = new Map();
        const valueToPartIdentifierId: Map<string, string> = new Map();

        try {
            const allIdentifierValues = [...new Set(records.flatMap(r => r.identifiers.map(i => i.value)))];

            const existingPIs = allIdentifierValues.length > 0
                ? await db
                    .select({ id: partIdentifiers.id, partId: partIdentifiers.partId, value: partIdentifiers.value })
                    .from(partIdentifiers)
                    .where(inArray(partIdentifiers.value, allIdentifierValues))
                : [];

            for (const pi of existingPIs) {
                if (!valueToPartIds.has(pi.value)) valueToPartIds.set(pi.value, new Set());
                valueToPartIds.get(pi.value)!.add(pi.partId);
                if (!valueToPartIdentifierId.has(pi.value)) valueToPartIdentifierId.set(pi.value, pi.id);
            }
        } catch (e: unknown) {
            console.error(`failed to get partIdentifiers in phase 1 of batch:`, e);
            throw e;
        }

        return [valueToPartIds, valueToPartIdentifierId];
    }

    // Bulk-fetch existing fitments for all (make, model, year) combos in the batch (inside write tx).
    private async getFitmentMappings(
        records: VendorRecord[],
        tx: Tx,
    ): Promise<Map<string, string>> {
        const fitmentKeyToId = new Map<string, string>();
        const allFitments = records.flatMap(r => r.fitments);
        if (allFitments.length === 0) return fitmentKeyToId;

        const makes = [...new Set(allFitments.map(f => f.make))];
        const models = [...new Set(allFitments.map(f => f.model))];
        const years = [...new Set(allFitments.map(f => f.year))];

        const existingFitments = await tx
            .select({ id: fitments.id, make: fitments.make, model: fitments.model, year: fitments.year, constraint: fitments.constraint, trim: fitments.trim, engine: fitments.engine })
            .from(fitments)
            .where(and(inArray(fitments.make, makes), inArray(fitments.model, models), inArray(fitments.year, years)));

        for (const f of existingFitments) {
            fitmentKeyToId.set(this.fitmentKey(f), f.id);
        }
        return fitmentKeyToId;
    }

    // Phase 1c (in-tx): bulk-insert all unique fitments missing from fitmentKeyToId,
    // populating their IDs back into the map. Uses onConflictDoUpdate with a no-op SET
    // so RETURNING gives us IDs for both inserted and pre-existing rows in a single call.
    private async bulkResolveFitments(
        tx: Tx,
        records: ResolvedRecord[],
        fitmentKeyToId: Map<string, string>,
    ): Promise<void> {
        await this.dropStaleFitmentCacheEntries(tx, fitmentKeyToId);

        const seen = new Set<string>();
        const toInsert: Array<typeof fitments.$inferInsert> = [];
        for (const r of records) {
            for (const f of r.record.fitments) {
                const key = this.fitmentKey(f);
                if (seen.has(key) || fitmentKeyToId.has(key)) continue;
                seen.add(key);
                toInsert.push({
                    make: f.make, model: f.model, year: f.year,
                    constraint: f.constraint ?? null, trim: f.trim ?? null, engine: f.engine ?? null,
                });
            }
        }
        if (toInsert.length === 0) return;

        const CHUNK = 5_000;
        for (let i = 0; i < toInsert.length; i += CHUNK) {
            const slice = toInsert.slice(i, i + CHUNK);
            const rows = await tx
                .insert(fitments)
                .values(slice)
                .onConflictDoUpdate({
                    target: [fitments.make, fitments.model, fitments.year, fitments.constraint, fitments.trim, fitments.engine],
                    set: { make: sql`excluded.make` },
                })
                .returning({ id: fitments.id, make: fitments.make, model: fitments.model, year: fitments.year, constraint: fitments.constraint, trim: fitments.trim, engine: fitments.engine });
            for (const row of rows) fitmentKeyToId.set(this.fitmentKey(row), row.id);
        }
    }

    // Phase 2: categorize records by # distinct parts their identifiers resolve to
    private validateRecords(
        records: VendorRecord[],
        valueToPartIds: Map<string, Set<string>>,
        valueToPartIdentifierId: Map<string, string>,
    ): [ResolvedRecord[], ResolvedRecord[], ResolvedRecord[]] {
        const newRecords: ResolvedRecord[] = [];
        const existingRecords: ResolvedRecord[] = [];
        const conflictRecords: ResolvedRecord[] = [];

        for (const record of records) {
            const recordPartIds: Set<string> = new Set();
            let recordPartIdentifierId: string | undefined;

            for (const identifier of record.identifiers) {
                const partIds = valueToPartIds.get(identifier.value) ?? [];
                for (const partId of partIds) recordPartIds.add(partId);
                if (!recordPartIdentifierId) recordPartIdentifierId = valueToPartIdentifierId.get(identifier.value);
            }

            const resolved: ResolvedRecord = {
                record,
                partIds: recordPartIds,
                partIdentifierId: recordPartIdentifierId ?? '',
                isValid: recordPartIds.size <= 1,
                isNew: recordPartIds.size === 0,
            };

            if (recordPartIds.size > 1) {
                console.warn(`Skipping record ${record.listing.vendorListingExternalId}: identifiers resolve to ${recordPartIds.size} parts`);
                conflictRecords.push(resolved);
            } else if (recordPartIds.size === 1) {
                existingRecords.push(resolved);
            } else {
                newRecords.push(resolved);
            }
        }

        return [newRecords, existingRecords, conflictRecords];
    }

    // Phase 3: group isNew records by normalized category:name for batch part creation
    private getNewPartGroups(newRecords: ResolvedRecord[]): Map<string, ResolvedRecord[]> {
        const groups = new Map<string, ResolvedRecord[]>();
        for (const r of newRecords) {
            const key = `${r.record.part.category}:${r.record.part.name.toLowerCase().trim()}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(r);
        }
        return groups;
    }

    private fitmentKey(f: { make: string; model: string; year: number; constraint?: string | null; trim?: string | null; engine?: string | null }): string {
        return `${f.make}:${f.model}:${f.year}:${f.constraint ?? ''}:${f.trim ?? ''}:${f.engine ?? ''}`;
    }

    /** Remove prefetch map entries whose fitment rows no longer exist (avoids part_fitments FK violations). */
    private async dropStaleFitmentCacheEntries(
        tx: Tx,
        fitmentKeyToId: Map<string, string>,
    ): Promise<void> {
        const cachedIds = [...new Set(fitmentKeyToId.values())];
        if (cachedIds.length === 0) return;

        const existing = await tx
            .select({ id: fitments.id })
            .from(fitments)
            .where(inArray(fitments.id, cachedIds));
        const live = new Set(existing.map(r => r.id));
        for (const [key, id] of fitmentKeyToId) {
            if (!live.has(id)) fitmentKeyToId.delete(key);
        }
    }

    private dedupePartFitmentPairs(pairs: Array<{ partId: string; fitmentId: string }>): Array<{ partId: string; fitmentId: string }> {
        const seen = new Set<string>();
        const out: Array<{ partId: string; fitmentId: string }> = [];
        for (const p of pairs) {
            const key = `${p.partId}:${p.fitmentId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(p);
        }
        return out;
    }

    private async getOrCreateWarehouseLocation(
        tx: Tx,
        loc: NonNullable<VendorRecord['listing']['warehouseLocation']>,
        cache: Map<string, string>,
    ): Promise<string> {
        const key = `${loc.country}|${loc.stateOrProvince ?? ''}|${loc.city ?? ''}|${loc.postalCode ?? ''}`;
        const cached = cache.get(key);
        if (cached) return cached;

        const [existing] = await tx
            .select({ id: warehouseLocations.id })
            .from(warehouseLocations)
            .where(
                and(
                    eq(warehouseLocations.country, loc.country),
                    eq(warehouseLocations.stateOrProvince, loc.stateOrProvince ?? ''),
                    eq(warehouseLocations.city, loc.city ?? ''),
                    eq(warehouseLocations.postalCode, loc.postalCode ?? ''),
                ),
            )
            .limit(1);

        if (existing) {
            cache.set(key, existing.id);
            return existing.id;
        }

        const [inserted] = await tx
            .insert(warehouseLocations)
            .values({ country: loc.country, stateOrProvince: loc.stateOrProvince, city: loc.city, postalCode: loc.postalCode })
            .onConflictDoNothing()
            .returning({ id: warehouseLocations.id });

        const id = inserted?.id ?? (await tx.select({ id: warehouseLocations.id }).from(warehouseLocations).where(eq(warehouseLocations.country, loc.country)).limit(1))[0]?.id ?? '';
        cache.set(key, id);
        return id;
    }
}
