import { randomBytes } from 'crypto';
import type { DistributedLockService, LockHandle } from './distributedLock';

/**
 * In-process mutex. Safe only within a single Node process.
 * Swap for RedisLockService when deploying multiple instances.
 */
export class InMemoryLockService implements DistributedLockService {
    private readonly locks = new Map<string, { token: string; expiresAt: number }>();
  
    async acquireLock(key: string, ttlMs: number): Promise<LockHandle> {
      const now = Date.now();
      const existing = this.locks.get(key);
      if (existing && existing.expiresAt > now) {
        throw new Error(`Failed to acquire lock: ${key}`);
      }
      const token = randomBytes(16).toString('hex');
      this.locks.set(key, { token, expiresAt: now + ttlMs });
      return { key, token };
    }
  
    async releaseLock(handle: LockHandle): Promise<void> {
      const existing = this.locks.get(handle.key);
      if (existing?.token === handle.token) {
        this.locks.delete(handle.key);
      }
    }
  }