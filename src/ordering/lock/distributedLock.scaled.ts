import { randomBytes } from 'crypto';
import type { DistributedLockService, LockHandle } from './distributedLock';

// ── Redis (Redlock) ──────────────────────────────────────────────
export interface RedisClientLike {
    set(key: string, value: string, opts: { NX: true; PX: number }): Promise<string | null>;
    eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}
  
const UNLOCK_LUA = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
    else
        return 0
    end
    `;
  
export class RedisLockService implements DistributedLockService {
    constructor(private readonly redis: RedisClientLike) {}

    async acquireLock(key: string, ttlMs: number): Promise<LockHandle> {
        const token = randomBytes(16).toString('hex');
        const result = await this.redis.set(key, token, { NX: true, PX: ttlMs });
        if (result === null) {
        throw new Error(`Failed to acquire lock: ${key}`);
        }
        return { key, token };
    }

    async releaseLock(handle: LockHandle): Promise<void> {
        await this.redis.eval(UNLOCK_LUA, [handle.key], [handle.token]);
    }
}
  