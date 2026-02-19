import type { OutboxRepository, OutboxEvent } from '@interfaces/repositories/outboxRepository';

const MAX_RETRIES = 5;
const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 1_000;

/**
 * Minimal Kafka producer interface.
 * In production, use KafkaJS or Confluent client.
 */
export interface KafkaProducer {
    send(topic: string, key: string, value: string): Promise<void>;
}

/**
 * Outbox publisher worker.
 * Polls `outbox_events WHERE published_at IS NULL`, publishes to Kafka,
 * then stamps `published_at`. Runs on a configurable interval.
 *
 * Guarantees at-least-once delivery. Kafka consumers must be idempotent.
 */
export class OutboxPublisher {
    private running = false;
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly outboxRepo: OutboxRepository,
        private readonly kafka: KafkaProducer,
    ) {}

    start(): void {
        if (this.running) return;
        this.running = true;
        this.poll();
    }

    stop(): void {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private async poll(): Promise<void> {
        if (!this.running) return;

        try {
            const events = await this.outboxRepo.findUnpublished(BATCH_SIZE);

            for (const event of events) {
                await this.publishEvent(event);
            }
        } catch (err) {
            // Log error but don't crash the worker
            console.error('[OutboxPublisher] Poll error:', err);
        }

        // Schedule next poll
        this.timer = setTimeout(() => this.poll(), POLL_INTERVAL_MS);
    }

    private async publishEvent(event: OutboxEvent): Promise<void> {
        try {
            await this.kafka.send(
                event.topic,
                event.aggregateId, // Partition key = orderId for ordering
                JSON.stringify(event.payload),
            );
            await this.outboxRepo.markPublished(event.id);
        } catch (err) {
            await this.outboxRepo.incrementRetryCount(event.id);
            if (event.retryCount + 1 >= MAX_RETRIES) {
                await this.outboxRepo.markFailed(event.id);
                console.error(`[OutboxPublisher] Event ${event.id} permanently failed after ${MAX_RETRIES} retries`);
            }
        }
    }
}
