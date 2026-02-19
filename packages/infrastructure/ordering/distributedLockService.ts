import type { DistributedLockService, LockHandle } from '@interfaces/services/distributedLockService';
import { randomBytes } from 'crypto';

/**
 * Redis-backed distributed lock service using the Redlock algorithm.
 *
 * In production, pass a real Redis client. In tests, use `InMemoryLockService`.
 */
export class RedisDistributedLockService implements DistributedLockService {
    constructor(
        private readonly redis: {
            set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>;
            eval(script: string, keys: string[], args: string[]): Promise<unknown>;
        },
    ) {}

    async acquireLock(key: string, ttlMs: number): Promise<LockHandle> {
        const token = randomBytes(16).toString('hex');
        const result = await this.redis.set(key, token, { NX: true, PX: ttlMs });
        if (result === null) {
            throw new Error(`Failed to acquire lock: ${key}`);
        }
        return { key, token };
    }

    async releaseLock(handle: LockHandle): Promise<void> {
        // Lua script ensures we only delete if we still own the lock
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        await this.redis.eval(script, [handle.key], [handle.token]);
    }
}

/**
 * In-memory lock service for unit tests.
 * NOT suitable for multi-process environments.
 */
export class InMemoryLockService implements DistributedLockService {
    private locks = new Map<string, { token: string; expiresAt: number }>();

    async acquireLock(key: string, ttlMs: number): Promise<LockHandle> {
        this.cleanExpired();
        if (this.locks.has(key)) {
            throw new Error(`Failed to acquire lock: ${key}`);
        }
        const token = randomBytes(16).toString('hex');
        this.locks.set(key, { token, expiresAt: Date.now() + ttlMs });
        return { key, token };
    }

    async releaseLock(handle: LockHandle): Promise<void> {
        const existing = this.locks.get(handle.key);
        if (existing && existing.token === handle.token) {
            this.locks.delete(handle.key);
        }
    }

    private cleanExpired(): void {
        const now = Date.now();
        for (const [key, val] of this.locks) {
            if (val.expiresAt <= now) {
                this.locks.delete(key);
            }
        }
    }
}
