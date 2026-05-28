import type { EventPublisher } from './eventPublisher';

export type Handler = (key: string, payload: string) => Promise<void>;

/**
 * Dispatches events to in-process handlers registered via `on`.
 * Suitable for single-instance deployments; swap for KafkaEventPublisher at scale.
 */
export class InProcessEventPublisher implements EventPublisher {
    private readonly handlers = new Map<string, Handler[]>();
  
    on(topic: string, handler: Handler): void {
      const list = this.handlers.get(topic) ?? [];
      list.push(handler);
      this.handlers.set(topic, list);
    }
  
    async publish(topic: string, key: string, payload: string): Promise<void> {
      for (const handler of this.handlers.get(topic) ?? []) {
        await handler(key, payload);
      }
    }
  }