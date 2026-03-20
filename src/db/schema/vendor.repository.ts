import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { vendors, warehouseLocations, vendorWarehouseLocations } from '../models';

export type VendorRow = typeof vendors.$inferSelect;
export type VendorInsert = typeof vendors.$inferInsert;

export class VendorRepo {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<VendorRow | null> {
    const [row] = await this.db.select().from(vendors).where(eq(vendors.id, id));
    return row ?? null;
  }

  async findAll(): Promise<VendorRow[]> {
    return this.db.select().from(vendors);
  }

  /** Upsert a vendor by slug id (e.g. 'lkq'). Safe to call on every deploy. */
  async upsert(input: Omit<VendorInsert, 'createdAt' | 'updatedAt'>): Promise<VendorRow> {
    const [row] = await this.db
      .insert(vendors)
      .values({ ...input, createdAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: vendors.id,
        set: {
          name: input.name,
          vendorType: input.vendorType,
          integrationType: input.integrationType,
          apiEndpoint: input.apiEndpoint,
          orderingMode: input.orderingMode,
          orderContactEmail: input.orderContactEmail,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async getOrderingMode(vendorId: string): Promise<VendorRow['orderingMode']> {
    const [row] = await this.db
      .select({ orderingMode: vendors.orderingMode })
      .from(vendors)
      .where(eq(vendors.id, vendorId));
    if (!row) throw new Error(`Vendor ${vendorId} not found`);
    return row.orderingMode;
  }
}
