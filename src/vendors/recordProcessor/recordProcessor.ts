import { VendorRecord } from "../clients/vendorRecord";
import { db, parts, partIdentifiers, fitments, partFitments, listings, listingImages } from "@repo/db";
import { inArray, and } from "drizzle-orm";

export interface BatchResult {
  succeeded: number;
  failed: number;
  skipped: number;
}

interface ResolvedRecord {
    record: VendorRecord;
    partIds: Set<string>;
    partIdentifierId: string;       // empty string if isNew
    isValid: boolean;
    isNew: boolean;
    confidence?: number;
}

// validates records and upserts safe records to db
export interface RecordProcessor {
    validateAndUpsert(records: VendorRecord[], vendorId: string): Promise<BatchResult>;
}


// implements record processor for drizzle Postgres SQL
export default class DrizzleRecordProcessor implements RecordProcessor {

    async validateAndUpsert(records: VendorRecord[], vendorId: string): Promise<BatchResult> {
        // Phase 1: bulk reads
        const [valueToPartIds, valueToPartIdentifierId] = await this.getExistingPartIdentifierMappings(records);
        const fitmentKeyToId = await this.getFitmentMappings(records);

        // Phase 2: in-memory resolve → three separate arrays
        const [newRecords, existingRecords, conflictRecords]: [ResolvedRecord[], ResolvedRecord[], ResolvedRecord[]] =
            this.validateRecords(records, valueToPartIds, valueToPartIdentifierId);

        // Phase 3: group new-part records by normalized category:name
        const newPartGroups: Map<string, ResolvedRecord[]> = this.getNewPartGroups(newRecords);

        // Phase 4: single transaction
        let succeeded = 0;
        let failed = 0;

        type ListingQueueItem = { partIdentifierId: string; record: VendorRecord; confidence: number };
        const listingQueue: ListingQueueItem[] = [];

        await db.transaction(async (tx) => {

            // 4a: insert one part per new-part group, then fitments + identifiers
            for (const [, group] of newPartGroups) {
                const rep = group[0].record.part;

                const [newPart] = await tx
                    .insert(parts)
                    .values({
                        name: rep.name,
                        category: rep.category as typeof parts.$inferInsert['category'],
                        position: (rep.position ?? null) as typeof parts.$inferInsert['position'],
                    })
                    .returning({ id: parts.id });

                // deduplicate fitments across the whole group before writing
                const groupFitmentKeys = new Set<string>();
                for (const r of group) {
                    for (const f of r.record.fitments) {
                        const key = this.fitmentKey(f);
                        if (groupFitmentKeys.has(key)) continue;
                        groupFitmentKeys.add(key);

                        let fitmentId = fitmentKeyToId.get(key);
                        if (!fitmentId) {
                            const [inserted] = await tx
                                .insert(fitments)
                                .values({ make: f.make, model: f.model, year: f.year, constraint: f.constraint ?? null, trim: f.trim ?? null, engine: f.engine ?? null })
                                .onConflictDoNothing()
                                .returning({ id: fitments.id });
                            if (inserted) {
                                fitmentId = inserted.id;
                                fitmentKeyToId.set(key, fitmentId);
                            }
                        }
                        if (fitmentId) {
                            await tx.insert(partFitments).values({ partId: newPart.id, fitmentId }).onConflictDoNothing();
                        }
                    }
                }

                // insert identifiers per record; first returned id is the listing's partIdentifierId
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
                }
            }

            // 4b: existing parts — add any new identifiers and fitments not yet linked
            for (const r of existingRecords) {
                const partId = [...r.partIds][0];

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
                    const key = this.fitmentKey(f);
                    let fitmentId = fitmentKeyToId.get(key);
                    if (!fitmentId) {
                        const [inserted] = await tx
                            .insert(fitments)
                            .values({ make: f.make, model: f.model, year: f.year, constraint: f.constraint ?? null, trim: f.trim ?? null, engine: f.engine ?? null })
                            .onConflictDoNothing()
                            .returning({ id: fitments.id });
                        if (inserted) {
                            fitmentId = inserted.id;
                            fitmentKeyToId.set(key, fitmentId);
                        }
                    }
                    if (fitmentId) {
                        await tx.insert(partFitments).values({ partId, fitmentId }).onConflictDoNothing();
                    }
                }

                listingQueue.push({ partIdentifierId: r.partIdentifierId, record: r.record, confidence: r.confidence ?? 0.9 });
            }

            // 4c: upsert listings, collect returned ids for image writes
            const now = new Date();
            type ImageRow = { url: string; listingId: string; imageType: string | null; sortOrder: number };
            const imageQueue: ImageRow[] = [];

            for (const { partIdentifierId, record, confidence } of listingQueue) {
                if (!partIdentifierId) { failed++; continue; }
                const l = record.listing;

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
                        confidenceScore: confidence.toString(),
                        source: 'VENDOR_API',
                        lastSeenAt: now,
                        lastVerifiedAt: now,
                    })
                    .onConflictDoUpdate({
                        target: [listings.vendorId, listings.vendorListingExternalId],
                        set: {
                            partIdentifierId,
                            availabilityStatus: l.availabilityStatus,
                            priceMinorMin: l.priceMinorMin,
                            priceMinorMax: l.priceMinorMax,
                            quantityAvailable: l.quantityAvailable,
                            estimatedShipTimeHours: l.estimatedShipTimeHours,
                            confidenceScore: confidence.toString(),
                            isActive: true,
                            lastSeenAt: now,
                            lastVerifiedAt: now,
                            updatedAt: now,
                        },
                    })
                    .returning({ listingId: listings.id });

                if (l.images?.length) {
                    imageQueue.push(...l.images.map((img, i) => ({
                        url: img.url,
                        listingId: row.listingId,
                        imageType: img.type ?? null,
                        sortOrder: i,
                    })));
                }
                succeeded++;
            }

            // 4d: bulk insert images — onConflictDoNothing keyed on url PK
            if (imageQueue.length > 0) {
                await tx.insert(listingImages).values(imageQueue).onConflictDoNothing();
            }
        });

        return { succeeded, failed, skipped: conflictRecords.length };
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

    // Phase 1b: bulk-fetch existing fitments for all (make, model, year) combos in the batch
    private async getFitmentMappings(records: VendorRecord[]): Promise<Map<string, string>> {
        const fitmentKeyToId = new Map<string, string>();
        const allFitments = records.flatMap(r => r.fitments);
        if (allFitments.length === 0) return fitmentKeyToId;

        const makes = [...new Set(allFitments.map(f => f.make))];
        const models = [...new Set(allFitments.map(f => f.model))];
        const years = [...new Set(allFitments.map(f => f.year))];

        const existingFitments = await db
            .select({ id: fitments.id, make: fitments.make, model: fitments.model, year: fitments.year, constraint: fitments.constraint, trim: fitments.trim, engine: fitments.engine })
            .from(fitments)
            .where(and(inArray(fitments.make, makes), inArray(fitments.model, models), inArray(fitments.year, years)));

        for (const f of existingFitments) {
            fitmentKeyToId.set(this.fitmentKey(f), f.id);
        }
        return fitmentKeyToId;
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
}
