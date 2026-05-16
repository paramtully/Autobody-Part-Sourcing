import 'dotenv/config';
import type { SQSEvent } from 'aws-lambda';
import { db, OutboxRepo } from '@repo/db';
import {
  InProcessEventPublisher,
  OutboxPublisher,
  ORDER_TOPICS,
  VendorOrderService,
} from '@repo/ordering';
import { StripePaymentAdapter } from '@repo/ordering/stripe';

const paymentProvider = new StripePaymentAdapter();
const vendorOrderService = new VendorOrderService();
const outboxRepo = new OutboxRepo(db);

const eventPublisher = new InProcessEventPublisher();

eventPublisher.on(ORDER_TOPICS.PAYMENT_AUTHORIZED, async (_key, payload) => {
  const { orderId } = JSON.parse(payload) as { orderId: string };
  await vendorOrderService.placeOrder(orderId);
});

eventPublisher.on(ORDER_TOPICS.PAYMENT_CANCEL_REQUIRED, async (_key, payload) => {
  const { providerPaymentId } = JSON.parse(payload) as { providerPaymentId: string };
  await paymentProvider.cancelPayment(providerPaymentId);
});

const publisher = new OutboxPublisher(outboxRepo, eventPublisher);

// Lambda handler — invoked by SQS (doorbell) or EventBridge safety-net schedule.
// The SQS message body is intentionally ignored; the outbox table is the source
// of truth. drainOnce() is idempotent via markPublished + retryCount.
export async function handler(_evt: SQSEvent | unknown): Promise<{ published: number; failed: number }> {
  return publisher.drainOnce();
}
