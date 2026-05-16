import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-west-2' });
const QueueUrl = process.env['OUTBOX_QUEUE_URL'];

/**
 * Fires an empty "doorbell" message to the outbox SQS queue after a DB
 * transaction that wrote outbox_events rows has committed.
 *
 * Correctness does NOT depend on this call succeeding — the paymentWorker
 * has a 5-minute EventBridge safety-net that drains any missed rows.
 * Never call this inside a DB transaction.
 */
export async function ringOutboxDoorbell(): Promise<void> {
  if (!QueueUrl) {
    // OUTBOX_QUEUE_URL is not set in local dev — skip silently
    return;
  }
  try {
    await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: '{}' }));
  } catch (err) {
    console.warn('[outbox] doorbell send failed; safety-net schedule will catch this', err);
  }
}
