import { logger } from "../../core/logger/logger.service";
import { cacheService as inMemoryCache } from "../../core/cache/cache.service";
import { createDatabaseAdapters, createCacheService, type DatabaseAdapters } from "./database.factory";
import type { ICacheService } from "./interfaces/cache";
import type {
    AdminRecord,
    GroupFilter,
    GroupRecord,
    GroupSettingsRecord,
    GroupParticipantStats,
    PaginatedResult,
    SafeAdminRecord,
    SessionRecord,
    UserFilter,
    UserRecord,
    UserSummaryStats,
    UserRole,
} from "./interfaces/types";

class DatabaseService {
    private static instance: DatabaseService;
    private adapters: DatabaseAdapters;
    private cache: ICacheService;
    private initPromise: Promise<void>;

    private readonly CACHE_TTL = {
        USER: 5 * 60 * 1000,     // 5 minutes
        GROUP: 10 * 60 * 1000,   // 10 minutes
    };

    private constructor() {
        this.adapters = createDatabaseAdapters();
        this.cache = inMemoryCache;
        this.initPromise = this.initialize();
        this.initPromise.catch(() => void 0);
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    public ready(): Promise<void> {
        return this.initPromise;
    }

    private async initialize(): Promise<void> {
        try {
            if (this.adapters.connect) await this.adapters.connect();
            logger.info(`Database connected (provider: ${process.env.DB_PROVIDER ?? "mongodb"})`);
        } catch (error) {
            logger.error(
                `Database connection failed: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }

        // Upgrade cache to Redis if available
        try {
            const redisCacheService = await createCacheService();
            if (redisCacheService !== this.cache) {
                this.cache = redisCacheService;
                logger.info("Redis cache connected");
            }
        } catch {
            // Redis not available — stay on in-memory cache
        }
    }

    /**
     * Returns the underlying Prisma client for adapters that support it.
     * @deprecated Use databaseService methods instead of raw Prisma access.
     */
    public getPrismaClient(): any {
        if (this.adapters.getPrismaClient) return this.adapters.getPrismaClient();
        throw new Error(
            `The active DB adapter (${process.env.DB_PROVIDER ?? "mongodb"}) does not expose a Prisma client.`
        );
    }

    // ─── User ────────────────────────────────────────────────────────────────

    public async getUser(userId: string): Promise<UserRecord | null> {
        const cacheKey = `user:${userId}`;
        const user = await this.cache.getOrSet(
            cacheKey,
            () => this.adapters.user.getUser(userId),
            this.CACHE_TTL.USER
        );

        if (user && (!user.level || !user.stats)) {
            return this.initializeUserLevelAndStats(userId);
        }

        return user;
    }

    private async initializeUserLevelAndStats(userId: string): Promise<UserRecord> {
        const user = await this.adapters.user.updateUser(userId, {
            level: { level: 1, xp: 0, totalXp: 0 },
            stats: {
                totalCommands: 0,
                commandsUsed: [],
                lastCommandTime: 0,
                joinedAt: Math.floor(Date.now() / 1000),
            },
        });
        this.cache.set(`user:${userId}`, user, this.CACHE_TTL.USER);
        return user;
    }

    public async upsertUser(userId: string, name?: string): Promise<UserRecord> {
        const user = await this.adapters.user.upsertUser(userId, name ?? null);
        this.cache.set(`user:${userId}`, user, this.CACHE_TTL.USER);
        return user;
    }

    public async updateUser(userId: string, data: any): Promise<UserRecord> {
        const user = await this.adapters.user.updateUser(userId, data);
        this.cache.set(`user:${userId}`, user, this.CACHE_TTL.USER);
        return user;
    }

    public async createUser(data: Partial<UserRecord> & { userId: string }): Promise<UserRecord> {
        const user = await this.adapters.user.upsertUser(data.userId, data.name ?? null, data);
        this.cache.set(`user:${data.userId}`, user, this.CACHE_TTL.USER);
        return user;
    }

    public async deleteUser(userId: string): Promise<UserRecord> {
        const user = await this.adapters.user.deleteUser(userId);
        this.cache.delete(`user:${userId}`);
        return user;
    }

    public async getUserCount(filter?: { role?: UserRole; isBanned?: boolean }): Promise<number> {
        return this.adapters.user.getUserCount(filter);
    }

    public async getAllUsers(): Promise<UserRecord[]> {
        return this.adapters.user.getAllUsers();
    }

    public async findUsers(filter: UserFilter): Promise<PaginatedResult<UserRecord>> {
        return this.adapters.user.findUsers(filter);
    }

    public async getUserSummaryStats(now: number): Promise<UserSummaryStats> {
        return this.adapters.user.getUserSummaryStats(now);
    }

    public async resetUserLimits(limit: number): Promise<void> {
        await this.adapters.user.resetUserLimits(limit);
        this.cache.clear();
        logger.info("User limits reset, cache cleared");
    }

    // ─── Leveling ────────────────────────────────────────────────────────────

    public async addUserXP(
        userId: string,
        xpToAdd: number,
        commandName: string
    ): Promise<{ user: UserRecord; leveledUp: boolean; newLevel?: number }> {
        const user = await this.getUser(userId);
        if (!user) throw new Error("User not found");

        const currentLevel = user.level?.level ?? 1;
        const currentXp = user.level?.xp ?? 0;
        const totalXp = user.level?.totalXp ?? 0;

        const { addXP } = await import("../../utils/leveling");
        const result = addXP(currentLevel, currentXp, totalXp, xpToAdd);

        const commandsUsed = [...(user.stats?.commandsUsed ?? [])];
        const commandIndex = commandsUsed.findIndex((c) => c.command === commandName);
        if (commandIndex >= 0) {
            commandsUsed[commandIndex] = { ...commandsUsed[commandIndex], count: commandsUsed[commandIndex].count + 1 };
        } else {
            commandsUsed.push({ command: commandName, count: 1 });
        }

        const updatedUser = await this.adapters.user.updateUser(userId, {
            level: { level: result.newLevel, xp: result.newXp, totalXp: result.newTotalXp },
            stats: {
                totalCommands: (user.stats?.totalCommands ?? 0) + 1,
                commandsUsed,
                lastCommandTime: Math.floor(Date.now() / 1000),
                joinedAt: user.stats?.joinedAt ?? Math.floor(Date.now() / 1000),
            },
        });

        this.cache.delete(`user:${userId}`);

        return {
            user: updatedUser,
            leveledUp: result.leveledUp,
            newLevel: result.leveledUp ? result.newLevel : undefined,
        };
    }

    // ─── Group ───────────────────────────────────────────────────────────────

    public async getGroup(groupId: string): Promise<GroupRecord | null> {
        const cacheKey = `group:${groupId}`;
        return this.cache.getOrSet(
            cacheKey,
            () => this.adapters.group.getGroup(groupId),
            this.CACHE_TTL.GROUP
        );
    }

    public async upsertGroup(groupId: string, groupData: any): Promise<GroupRecord> {
        const group = await this.adapters.group.upsertGroup(groupId, groupData);
        this.cache.set(`group:${groupId}`, group, this.CACHE_TTL.GROUP);
        return group;
    }

    public async updateGroup(groupId: string, data: any): Promise<GroupRecord> {
        const group = await this.adapters.group.updateGroup(groupId, data);
        this.cache.delete(`group:${groupId}`);
        return group;
    }

    public async updateGroupSettings(groupId: string, settings: any): Promise<GroupRecord> {
        const group = await this.adapters.group.updateGroupSettings(groupId, settings);
        this.cache.delete(`group:${groupId}`);
        return group;
    }

    public async deleteGroup(groupId: string): Promise<GroupRecord> {
        const group = await this.adapters.group.deleteGroup(groupId);
        this.cache.delete(`group:${groupId}`);
        return group;
    }

    public async getGroupCount(filter?: GroupFilter): Promise<number> {
        return this.adapters.group.getGroupCount(filter);
    }

    public async getAllGroups(): Promise<GroupRecord[]> {
        return this.adapters.group.getAllGroups();
    }

    public async findGroups(filter: GroupFilter): Promise<PaginatedResult<GroupRecord>> {
        return this.adapters.group.findGroups(filter);
    }

    public async getGroupParticipantStats(): Promise<GroupParticipantStats> {
        return this.adapters.group.getGroupParticipantStats();
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    public async getAdminById(id: string): Promise<AdminRecord | null> {
        return this.adapters.admin.getAdminById(id);
    }

    public async findAdminByUsername(username: string): Promise<AdminRecord | null> {
        return this.adapters.admin.findAdminByUsername(username);
    }

    public async findAdminByPhoneNumber(phoneNumber: string): Promise<AdminRecord | null> {
        return this.adapters.admin.findAdminByPhoneNumber(phoneNumber);
    }

    public async createAdmin(data: { phoneNumber: string; username: string; password: string }): Promise<AdminRecord> {
        return this.adapters.admin.createAdmin(data);
    }

    public async updateAdmin(id: string, data: Partial<AdminRecord>): Promise<AdminRecord> {
        return this.adapters.admin.updateAdmin(id, data);
    }

    public async deleteAdmin(username: string): Promise<AdminRecord> {
        return this.adapters.admin.deleteAdmin(username);
    }

    public async getAllAdmins(): Promise<SafeAdminRecord[]> {
        return this.adapters.admin.getAllAdmins();
    }

    // ─── Session ─────────────────────────────────────────────────────────────

    public async getSession(sessionId: string): Promise<SessionRecord | null> {
        return this.adapters.session.getSession(sessionId);
    }

    public async setSession(sessionId: string, session: string): Promise<SessionRecord> {
        return this.adapters.session.setSession(sessionId, session);
    }

    public async deleteSession(sessionId: string): Promise<void> {
        return this.adapters.session.deleteSession(sessionId);
    }

    public async clearSessions(): Promise<void> {
        return this.adapters.session.clearSessions();
    }

    // ─── Batch ───────────────────────────────────────────────────────────────

    public async batchUpdateUsers(updates: Array<{ userId: string; data: any }>): Promise<void> {
        for (const { userId, data } of updates) {
            this.cache.delete(`user:${userId}`);
            await this.adapters.user.updateUser(userId, data);
        }
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    public async disconnect(): Promise<void> {
        if (this.adapters.disconnect) await this.adapters.disconnect();
        logger.info("Database disconnected");
    }
}

export const databaseService = DatabaseService.getInstance();
