// ── Distributed locking ──────────────────────────────────────────
export interface LockHandle {
    key: string;
    token: string;
}
  
export interface DistributedLockService {
    /**
     * Acquires a lock.
     * @param key - The key of the lock
     * @param ttlMs - The time-to-live of the lock in milliseconds
     * @returns The lock handle
     */
    acquireLock(key: string, ttlMs: number): Promise<LockHandle>;
    /**
     * Releases a lock.
     * @param handle - The lock handle
     * @returns The result of the lock release
     */
    releaseLock(handle: LockHandle): Promise<void>;
}