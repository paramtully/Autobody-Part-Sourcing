
// ── Event publishing ─────────────────────────────────────────────
export interface EventPublisher {
    /**
     * Publishes an event to the event bus.
     * @param topic - The topic to publish the event to
     * @param key - The key of the event
     * @param payload - The payload of the event
     * @returns The result of the event publication
     */
    publish(topic: string, key: string, payload: string): Promise<void>;
}