import 'dotenv/config';
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

// Lambda handler — invoked by scheduler (e.g. EventBridge cron)
export async function handler(): Promise<{ published: number; failed: number }> {
  return publisher.drainOnce();
}
