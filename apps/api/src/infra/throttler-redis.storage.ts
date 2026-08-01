import type { ThrottlerStorage } from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";
import type Redis from "ioredis";

/**
 * Minimal Redis-backed ThrottlerStorage (fixed window via INCR + PEXPIRE).
 * Every key carries a TTL — mandatory because Redis runs with noeviction.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttle:${throttlerName}:${key}`;
    const results = await this.redis.multi().incr(redisKey).pttl(redisKey).exec();
    const totalHits = Number(results?.[0]?.[1] ?? 1);
    let pttlMs = Number(results?.[1]?.[1] ?? -1);
    if (pttlMs < 0) {
      // First hit in this window (or TTL lost) — start the window.
      await this.redis.pexpire(redisKey, ttl);
      pttlMs = ttl;
    }
    const isBlocked = totalHits > limit;
    if (isBlocked && blockDuration > 0 && blockDuration !== ttl) {
      await this.redis.pexpire(redisKey, blockDuration);
      pttlMs = blockDuration;
    }
    const seconds = Math.max(1, Math.ceil(pttlMs / 1000));
    return {
      totalHits,
      timeToExpire: seconds,
      isBlocked,
      timeToBlockExpire: isBlocked ? seconds : 0,
    };
  }
}
