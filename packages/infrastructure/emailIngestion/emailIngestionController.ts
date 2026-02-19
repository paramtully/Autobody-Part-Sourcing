import { parseInboundEmail } from './emailParser';
import type { VendorEmailForwarder } from './vendorEmailForwarder';
import type { OutboxRepository } from '@interfaces/repositories/outboxRepository';

/**
 * Repository for vendor email logs.
 */
export interface VendorEmailLogRepository {
    create(input: {
        orderId: string | null;
        fromAddress: string;
        toAddress: string;
        subject: string;
        rawBody: string;
        parsedStatus: string | null;
        parsedTracking: string | null;
        processingStatus: string;
    }): Promise<{ id: string }>;
}

/**
 * Inbound email webhook handler for EMAIL_MANUAL vendor flow.
 *
 * Flow:
 * 1. Parse the inbound email
 * 2. Insert vendor_email_log
 * 3. Insert outbox event (vendor.email.received)
 * 4. Forward the email to the customer
 * 5. Return 200 (always — prevent provider retry storms)
 */
export class EmailIngestionController {
    constructor(
        private readonly emailLogRepo: VendorEmailLogRepository,
        private readonly outboxRepo: OutboxRepository,
        private readonly forwarder: VendorEmailForwarder,
        private readonly customerEmailLookup: (orderId: string) => Promise<string | null>,
    ) {}

    async handleInboundEmail(input: {
        fromAddress: string;
        toAddress: string;
        subject: string;
        body: string;
    }): Promise<{ status: number }> {
        const parsed = parseInboundEmail({
            toAddress: input.toAddress,
            subject: input.subject,
            body: input.body,
        });

        const processingStatus = parsed.orderId ? 'PENDING' : 'FAILED';

        // 1. Insert email log
        await this.emailLogRepo.create({
            orderId: parsed.orderId,
            fromAddress: input.fromAddress,
            toAddress: input.toAddress,
            subject: input.subject,
            rawBody: input.body,
            parsedStatus: parsed.status,
            parsedTracking: parsed.trackingNumber,
            processingStatus,
        });

        // 2. Insert outbox event if orderId was successfully extracted
        if (parsed.orderId) {
            await this.outboxRepo.create({
                topic: 'vendor.email.received',
                aggregateType: 'order',
                aggregateId: parsed.orderId,
                payload: {
                    orderId: parsed.orderId,
                    parsedStatus: parsed.status,
                    trackingNumber: parsed.trackingNumber,
                    fromAddress: input.fromAddress,
                },
            });
        }

        // 3. Forward email to customer (non-blocking — failure doesn't affect response)
        if (parsed.orderId) {
            try {
                const customerEmail = await this.customerEmailLookup(parsed.orderId);
                if (customerEmail) {
                    await this.forwarder.forward({
                        toEmail: customerEmail,
                        fromAddress: input.fromAddress,
                        subject: input.subject,
                        body: input.body,
                    });
                }
            } catch {
                // Forwarding failure is non-critical; log already persisted
            }
        }

        // 4. Always return 200 — prevents email provider retry storms
        return { status: 200 };
    }
}
