import type { Db } from '../client';
import { vendorEmailLogs } from '../models';

export type EmailLogRow = typeof vendorEmailLogs.$inferSelect;

export class EmailLogRepo {
  constructor(private readonly db: Db) {}

  async create(input: {
    orderId?: string;
    fromAddress: string;
    toAddress: string;
    subject?: string;
    rawBody?: string;
    parsedStatus?: string;
    parsedTracking?: string;
    processingStatus?: string;
  }): Promise<EmailLogRow> {
    const [row] = await this.db
      .insert(vendorEmailLogs)
      .values({
        orderId: input.orderId,
        fromAddress: input.fromAddress,
        toAddress: input.toAddress,
        subject: input.subject,
        rawBody: input.rawBody,
        parsedStatus: input.parsedStatus,
        parsedTracking: input.parsedTracking,
        processingStatus: input.processingStatus ?? 'PENDING',
      })
      .returning();
    return row;
  }
}
