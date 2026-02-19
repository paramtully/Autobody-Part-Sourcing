/**
 * Distributed lock abstraction (backed by Redis Redlock in production).
 */
export interface DistributedLockService {
    /**
     * Acquire a distributed lock.
     * @param key - Lock key (e.g. `lock:listing:{id}:hold`)
     * @param ttlMs - Lock time-to-live in milliseconds
     * @returns An opaque lock handle used for release
     * @throws if the lock cannot be acquired within the TTL
     */
    acquireLock(key: string, ttlMs: number): Promise<LockHandle>;

    /**
     * Release a previously acquired lock.
     */
    releaseLock(handle: LockHandle): Promise<void>;
}

export interface LockHandle {
    key: string;
    token: string;
}
