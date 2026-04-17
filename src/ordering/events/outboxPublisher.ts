/**
 * Polls the outbox table and publishes events via an injected EventPublisher.
 * The publisher decides the transport (in-process handlers vs Kafka).
 *
 * Usage:
 *  - Worker process: call `start()` for a continuous poll loop.
 *  - Vercel Cron:    call `drainOnce()` per invocation.
 */
import type { OutboxEventRow, OutboxRepo } from '@repo/db';
import type { EventPublisher } from './eventPublisher';
import type { NodeJS } from 'node';

export interface OutboxPublisherOptions {
  batchSize?: number;
  maxRetries?: number;
  pollIntervalMs?: number;
}

const DEFAULTS: Required<OutboxPublisherOptions> = {
  batchSize: 100,
  maxRetries: 5,
  pollIntervalMs: 1_000,
};

export class OutboxPublisher {
  private readonly opts: Required<OutboxPublisherOptions>;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly outboxRepo: OutboxRepo,
    private readonly publisher: EventPublisher,
    opts: OutboxPublisherOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Process all currently-unpublished events, then return. */
  async drainOnce(): Promise<{ published: number; failed: number }> {
    const events = await this.outboxRepo.findUnpublished(this.opts.batchSize);
    let published = 0;
    let failed = 0;
    for (const event of events) {
      if (await this.publishOne(event)) published++;
      else failed++;
    }
    return { published, failed };
  }

  private async loop(): Promise<void> {
    if (!this.running) return;
    try {
      await this.drainOnce();
    } catch (err) {
      console.error('[OutboxPublisher] poll error:', err);
    }
    this.timer = setTimeout(() => this.loop(), this.opts.pollIntervalMs);
  }

  private async publishOne(event: OutboxEventRow): Promise<boolean> {
    try {
      await this.publisher.publish(
        event.topic,
        event.aggregateId,
        JSON.stringify(event.payload),
      );
      await this.outboxRepo.markPublished(event.id);
      return true;
    } catch (err) {
      await this.outboxRepo.incrementRetryCount(event.id);
      if (event.retryCount + 1 >= this.opts.maxRetries) {
        await this.outboxRepo.markFailed(event.id);
        console.error(
          `[OutboxPublisher] event ${event.id} permanently failed after ${this.opts.maxRetries} retries`,
          err,
        );
      }
      return false;
    }
  }
}
