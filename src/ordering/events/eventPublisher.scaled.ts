import type { EventPublisher } from './eventPublisher';

// ── Kafka ────────────────────────────────────────────────────────

export interface KafkaProducerLike {
    /**
     * Sends a message to a Kafka topic.
     * @param topic - The topic to send the message to
     * @param key - The key of the message
     * @param value - The value of the message
     * @returns The result of the message sending
     */
    send(topic: string, key: string, value: string): Promise<void>;
}
  
export class KafkaEventPublisher implements EventPublisher {
    constructor(private readonly producer: KafkaProducerLike) {}
  
    async publish(topic: string, key: string, payload: string): Promise<void> {
      await this.producer.send(topic, key, payload);
    }
}