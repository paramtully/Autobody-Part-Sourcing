import { eq } from 'drizzle-orm';
import type {
    CheckoutQuoteRepository,
    CheckoutQuote,
    CreateQuoteInput,
} from '@interfaces/repositories/checkoutQuoteRepository';
import { checkoutQuotes } from '../schema/checkoutQuotes';
import type { db as DbType } from '../db';

type Db = typeof DbType;

export class CheckoutQuoteRepositoryImpl implements CheckoutQuoteRepository {
    constructor(private readonly db: Db) {}

    async create(input: CreateQuoteInput): Promise<CheckoutQuote> {
        const [row] = await this.db
            .insert(checkoutQuotes)
            .values({
                listingId: input.listingId,
                vendorId: input.vendorId,
                shippingAddress: input.shippingAddress,
                partPriceMinor: input.partPriceMinor,
                serviceFeeMinor: input.serviceFeeMinor,
                feePercentApplied: input.feePercentApplied.toString(),
                shippingMinor: input.shippingMinor,
                taxMinor: input.taxMinor,
                totalMinor: input.totalMinor,
                currency: input.currency,
                vendorQuoteReference: input.vendorQuoteReference,
                expiresAt: input.expiresAt,
            })
            .returning();

        return this.toDomain(row);
    }

    async findById(id: string): Promise<CheckoutQuote | null> {
        const [row] = await this.db
            .select()
            .from(checkoutQuotes)
            .where(eq(checkoutQuotes.id, id));
        return row ? this.toDomain(row) : null;
    }

    async markUsed(id: string): Promise<void> {
        await this.db
            .update(checkoutQuotes)
            .set({ usedAt: new Date() })
            .where(eq(checkoutQuotes.id, id));
    }

    private toDomain(row: typeof checkoutQuotes.$inferSelect): CheckoutQuote {
        return {
            id: row.id,
            listingId: row.listingId,
            vendorId: row.vendorId,
            shippingAddress: row.shippingAddress as any,
            partPriceMinor: row.partPriceMinor,
            serviceFeeMinor: row.serviceFeeMinor,
            feePercentApplied: parseFloat(row.feePercentApplied),
            shippingMinor: row.shippingMinor,
            taxMinor: row.taxMinor,
            totalMinor: row.totalMinor,
            currency: row.currency as any,
            vendorQuoteReference: row.vendorQuoteReference,
            expiresAt: row.expiresAt,
            usedAt: row.usedAt,
            createdAt: row.createdAt,
        };
    }
}
