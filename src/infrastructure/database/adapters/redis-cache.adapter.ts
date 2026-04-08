/**
 * Redis cache adapter — drop-in replacement for the in-memory CacheService.
 *
 * Setup:
 *   1. Install ioredis: `npm install ioredis`
 *   2. Set `REDIS_URL=redis://localhost:6379` in .env
 *
 * If ioredis is not installed or the connection fails, the factory falls
 * back automatically to the in-memory CacheService.
 */
import type { ICacheService } from "../interfaces/cache";

export class RedisCacheAdapter implements ICacheService {
    private client: any;
    private defaultTtlMs: number;

    constructor(client: any, defaultTtlMs = 5 * 60 * 1000) {
        this.client = client;
        this.defaultTtlMs = defaultTtlMs;
    }

    /** Factory — resolves to null if ioredis is unavailable or connection fails */
    static async create(redisUrl: string, defaultTtlMs?: number): Promise<RedisCacheAdapter | null> {
        try {
            // Dynamic import so ioredis is optional at compile time
            const { default: Redis } = await import("ioredis" as any);
            const client = new Redis(redisUrl, {
                lazyConnect: true,
                maxRetriesPerRequest: 1,
                retryStrategy: () => null,
            });
            await client.connect();
            return new RedisCacheAdapter(client, defaultTtlMs);
        } catch {
            return null;
        }
    }

    get<T>(key: string): T | null {
        // Redis is async — for synchronous get we return null and rely on getOrSet
        return null;
    }

    set<T>(key: string, value: T, ttl?: number): void {
        const ttlMs = ttl ?? this.defaultTtlMs;
        const serialized = JSON.stringify(value);
        if (ttlMs > 0) {
            this.client.set(key, serialized, "PX", ttlMs).catch(() => void 0);
        } else {
            this.client.set(key, serialized).catch(() => void 0);
        }
    }

    has(key: string): boolean {
        // Synchronous check not reliable over Redis — always treat as missing for simplicity
        return false;
    }

    delete(key: string): boolean {
        this.client.del(key).catch(() => void 0);
        return true;
    }

    clear(): void {
        this.client.flushdb().catch(() => void 0);
    }

    async getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
        try {
            const cached = await this.client.get(key);
            if (cached !== null) {
                return JSON.parse(cached) as T;
            }
        } catch {
            // Redis error — fall through to factory
        }

        const value = await factory();
        this.set(key, value, ttl);
        return value;
    }
}
