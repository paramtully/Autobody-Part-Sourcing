import { db } from '../db';
import { rawPayloads } from '../schema';
import { eq } from 'drizzle-orm';
import type { RawPayloadRepository } from '@interfaces/repositories/rawPayloadRepository';

export class RawPayloadRepositoryImpl implements RawPayloadRepository {
    async store(payload: {
        vendorId: string;
        payload: unknown;
        payloadHash: string;
    }): Promise<{ id: string; isNew: boolean }> {
        // Try to find existing by payloadHash (leverages unique index)
        const existing = await db
            .select({ id: rawPayloads.id })
            .from(rawPayloads)
            .where(eq(rawPayloads.payloadHash, payload.payloadHash))
            .limit(1);

        if (existing.length > 0) {
            return { id: existing[0].id, isNew: false };
        }

        // Insert new payload
        const [inserted] = await db
            .insert(rawPayloads)
            .values({
                vendorId: payload.vendorId,
                payload: payload.payload as any,
                payloadHash: payload.payloadHash,
            })
            .returning({ id: rawPayloads.id });

        return { id: inserted.id, isNew: true };
    }
}
