import type { EventPublisher } from './eventPublisher';

// ── Kafka ────────────────────────────────────────────────────────

export interface KafkaProducerLike {
    send(topic: string, key: string, value: string): Promise<void>;
  }
  
  export class KafkaEventPublisher implements EventPublisher {
    constructor(private readonly producer: KafkaProducerLike) {}
  
    async publish(topic: string, key: string, payload: string): Promise<void> {
      await this.producer.send(topic, key, payload);
    }
  }