import { eq, and, sql, getTableColumns } from 'drizzle-orm';
import type { Db } from '../client';
import { db } from '../client';
import { listings, vendors, partIdentifiers } from '../models/index.js';

export type ListingRow = typeof listings.$inferSelect;

export interface ListingWithRelations extends ListingRow {
  vendor: Pick<typeof vendors.$inferSelect, 'orderingMode'>;
  partIdentifier: Pick<typeof partIdentifiers.$inferSelect, 'value'>;
}

export class ListingRepo {
  private readonly db: Db;

  constructor(database: Db = db) {
    this.db = database;
  }

  async findById(id: string): Promise<ListingWithRelations | null> {
    const [row] = await this.db
      .select({
        ...getTableColumns(listings),
        vendor: { orderingMode: vendors.orderingMode },
        partIdentifier: { value: partIdentifiers.value },
      })
      .from(listings)
      .innerJoin(vendors, eq(listings.vendorId, vendors.id))
      .innerJoin(partIdentifiers, eq(listings.partIdentifierId, partIdentifiers.id))
      .where(eq(listings.id, id));
    return row ?? null;
  }

  async markStaleInactive(vendorId: string, notSeenSince: Date): Promise<number> {
    const result = await this.db
      .update(listings)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(listings.vendorId, vendorId),
          eq(listings.isActive, true),
          sql`${listings.lastSeenAt} < ${notSeenSince}`,
        ),
      )
      .returning({ id: listings.id });
    return result.length;
  }
}
