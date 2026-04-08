/**
 * DatabaseFactory — reads DB_PROVIDER and REDIS_URL from the environment
 * and returns the appropriate adapter instances.
 *
 * Supported DB_PROVIDER values:
 *   mongodb  (default) — requires DATABASE_URL=mongodb://...
 *   postgres           — requires DATABASE_URL=postgresql://...
 *                        and prisma/schema.postgres.prisma to be active
 *   sqlite             — requires DATABASE_URL=file:./data/chisato.db
 *                        and prisma/schema.sqlite.prisma to be active
 *   json               — no DATABASE_URL needed; stores data in data/*.json
 *
 * Optional Redis cache:
 *   REDIS_URL=redis://...  → uses RedisCacheAdapter
 *   (not set)              → falls back to in-memory CacheService
 */
import { MongoDBAdapter } from "./adapters/mongodb.adapter";
import { PostgresAdapter } from "./adapters/postgres.adapter";
import { SQLiteAdapter } from "./adapters/sqlite.adapter";
import { JsonAdapter } from "./adapters/json.adapter";
import { RedisCacheAdapter } from "./adapters/redis-cache.adapter";
import { cacheService as inMemoryCache } from "../../core/cache/cache.service";
import type { ICacheService } from "./interfaces/cache";
import type {
    IAdminRepository,
    IGroupRepository,
    ISessionRepository,
    IUserRepository,
} from "./interfaces/repositories";

export type DbProvider = "mongodb" | "postgres" | "sqlite" | "json";

export type DatabaseAdapters = {
    user: IUserRepository;
    group: IGroupRepository;
    admin: IAdminRepository;
    session: ISessionRepository;
    /** getPrismaClient is only defined for Prisma-based adapters */
    getPrismaClient?: () => any;
    connect?: () => Promise<void>;
    disconnect?: () => Promise<void>;
};

export function createDatabaseAdapters(): DatabaseAdapters {
    const provider = (process.env.DB_PROVIDER ?? "mongodb").toLowerCase() as DbProvider;

    switch (provider) {
        case "postgres": {
            const adapter = new PostgresAdapter();
            return {
                user: adapter,
                group: adapter,
                admin: adapter,
                session: adapter,
                getPrismaClient: () => adapter.getPrismaClient(),
                connect: () => adapter.connect(),
                disconnect: () => adapter.disconnect(),
            };
        }
        case "sqlite": {
            const adapter = new SQLiteAdapter();
            return {
                user: adapter,
                group: adapter,
                admin: adapter,
                session: adapter,
                getPrismaClient: () => adapter.getPrismaClient(),
                connect: () => adapter.connect(),
                disconnect: () => adapter.disconnect(),
            };
        }
        case "json": {
            const adapter = new JsonAdapter();
            return {
                user: adapter,
                group: adapter,
                admin: adapter,
                session: adapter,
            };
        }
        default: {
            const adapter = new MongoDBAdapter();
            return {
                user: adapter,
                group: adapter,
                admin: adapter,
                session: adapter,
                getPrismaClient: () => adapter.getPrismaClient(),
                connect: () => adapter.connect(),
                disconnect: () => adapter.disconnect(),
            };
        }
    }
}

/** Creates the appropriate cache service, falling back to in-memory if Redis is unavailable. */
export async function createCacheService(): Promise<ICacheService> {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
        const redis = await RedisCacheAdapter.create(redisUrl);
        if (redis) return redis;
        // Fall through to in-memory if Redis connection fails
    }
    return inMemoryCache;
}
