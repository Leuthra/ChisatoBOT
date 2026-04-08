/**
 * JSON file adapter — stores all data in JSON files under `data/`.
 *
 * Suitable for lightweight self-hosting without a database server.
 * NOT recommended for multi-instance deployments or high-traffic bots.
 *
 * File layout:
 *   data/users.json
 *   data/groups.json
 *   data/admins.json
 *   data/sessions.json
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
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
} from "../interfaces/types";
import type {
    IAdminRepository,
    IGroupRepository,
    ISessionRepository,
    IUserRepository,
} from "../interfaces/repositories";

type JsonStore = {
    users: Record<string, UserRecord>;
    groups: Record<string, GroupRecord>;
    admins: Record<string, AdminRecord>;
    sessions: Record<string, SessionRecord>;
};

const DEFAULT_SETTINGS: GroupSettingsRecord = {
    notify: false,
    welcome: true,
    welcomeMessage: null,
    leave: true,
    leaveMessage: null,
    mute: false,
    antilink: { status: false, mode: "kick", list: ["whatsapp"] },
    antibot: false,
    banned: [],
};

export class JsonAdapter implements IUserRepository, IGroupRepository, IAdminRepository, ISessionRepository {
    private dataDir: string;
    private store: JsonStore = { users: {}, groups: {}, admins: {}, sessions: {} };
    private dirty = new Set<keyof JsonStore>();
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(dataDir = path.join(process.cwd(), "data")) {
        this.dataDir = dataDir;
        this.ensureDataDir();
        this.loadAll();
        // Persist any remaining dirty state on process exit
        process.on("exit", () => this.flushAll());
        process.on("SIGINT", () => { this.flushAll(); process.exit(0); });
        process.on("SIGTERM", () => { this.flushAll(); process.exit(0); });
    }

    private ensureDataDir(): void {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    private filePath(name: keyof JsonStore): string {
        return path.join(this.dataDir, `${name}.json`);
    }

    private loadAll(): void {
        for (const name of ["users", "groups", "admins", "sessions"] as (keyof JsonStore)[]) {
            const file = this.filePath(name);
            if (fs.existsSync(file)) {
                try {
                    const raw = fs.readFileSync(file, "utf-8");
                    (this.store as any)[name] = JSON.parse(raw);
                } catch {
                    (this.store as any)[name] = {};
                }
            }
        }
    }

    private markDirty(name: keyof JsonStore): void {
        this.dirty.add(name);
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => {
                this.flushAll();
                this.flushTimer = null;
            }, 500);
        }
    }

    private flush(name: keyof JsonStore): void {
        fs.writeFileSync(this.filePath(name), JSON.stringify(this.store[name], null, 2));
    }

    private flushAll(): void {
        for (const name of this.dirty) {
            try { this.flush(name); } catch { /* ignore */ }
        }
        this.dirty.clear();
    }

    private newId(): string {
        return crypto.randomBytes(12).toString("hex");
    }

    /** Validates a store key is safe to use as an object property. */
    private safeKey(key: string): string {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
            throw new Error(`Invalid key: ${key}`);
        }
        return key;
    }

    // ─── User ────────────────────────────────────────────────────────────────

    async getUser(userId: string): Promise<UserRecord | null> {
        return this.store.users[this.safeKey(userId)] ?? null;
    }

    async upsertUser(userId: string, name?: string | null, overrides?: Partial<UserRecord>): Promise<UserRecord> {
        const key = this.safeKey(userId);
        const existing = this.store.users[key];
        if (existing) {
            if (name !== undefined) existing.name = name ?? null;
            this.markDirty("users");
            return existing;
        }

        const record: UserRecord = {
            id: this.newId(),
            userId,
            name: name ?? null,
            limit: 30,
            role: "free",
            expired: 0,
            isBanned: false,
            afk: { status: false, reason: null, since: 0 },
            level: { level: 1, xp: 0, totalXp: 0 },
            stats: {
                totalCommands: 0,
                commandsUsed: [],
                lastCommandTime: 0,
                joinedAt: Math.floor(Date.now() / 1000),
            },
            ...overrides,
        };

        this.store.users[key] = record;
        this.markDirty("users");
        return record;
    }

    async updateUser(userId: string, data: Partial<UserRecord>): Promise<UserRecord> {
        const key = this.safeKey(userId);
        const existing = this.store.users[key];
        if (!existing) throw new Error(`User not found: ${userId}`);

        if (data.name !== undefined) existing.name = data.name ?? null;
        if (data.limit !== undefined) existing.limit = data.limit;
        if (data.role !== undefined) existing.role = data.role;
        if (data.expired !== undefined) existing.expired = data.expired;
        if (data.isBanned !== undefined) existing.isBanned = data.isBanned;
        if (data.afk !== undefined) existing.afk = data.afk;
        if (data.level !== undefined) existing.level = data.level;
        if (data.stats !== undefined) existing.stats = data.stats;
        this.markDirty("users");
        return existing;
    }

    async deleteUser(userId: string): Promise<UserRecord> {
        const key = this.safeKey(userId);
        const record = this.store.users[key];
        if (!record) throw new Error(`User not found: ${userId}`);
        delete this.store.users[key];
        this.markDirty("users");
        return record;
    }

    async getUserCount(filter?: { role?: UserRole; isBanned?: boolean }): Promise<number> {
        return Object.values(this.store.users).filter((u) => {
            if (filter?.role && u.role !== filter.role) return false;
            if (filter?.isBanned !== undefined && u.isBanned !== filter.isBanned) return false;
            return true;
        }).length;
    }

    async getAllUsers(): Promise<UserRecord[]> {
        return Object.values(this.store.users);
    }

    async findUsers(filter: UserFilter): Promise<PaginatedResult<UserRecord>> {
        let results = Object.values(this.store.users);

        if (filter.role) results = results.filter((u) => u.role === filter.role);
        if (filter.isBanned !== undefined) results = results.filter((u) => u.isBanned === filter.isBanned);
        if (filter.search) {
            const s = filter.search.toLowerCase();
            results = results.filter(
                (u) => u.userId.toLowerCase().includes(s) || (u.name ?? "").toLowerCase().includes(s)
            );
        }

        const total = results.length;
        if (filter.skip) results = results.slice(filter.skip);
        if (filter.take) results = results.slice(0, filter.take);

        return { data: results, total };
    }

    async getUserSummaryStats(now: number): Promise<UserSummaryStats> {
        const users = Object.values(this.store.users);
        let totalLimit = 0;
        let maxLimit = 0;
        let minLimit = 0;
        let freeUsers = 0;
        let premiumUsers = 0;
        let premiumActive = 0;
        let premiumExpired = 0;
        let afkTotal = 0;
        let hasLimit = false;

        for (const user of users) {
            totalLimit += user.limit;
            if (!hasLimit) {
                minLimit = user.limit;
                maxLimit = user.limit;
                hasLimit = true;
            } else {
                if (user.limit > maxLimit) maxLimit = user.limit;
                if (user.limit < minLimit) minLimit = user.limit;
            }

            if (user.role === "free") freeUsers += 1;
            if (user.role === "premium") {
                premiumUsers += 1;
                if (user.expired === 0 || user.expired > now) {
                    premiumActive += 1;
                } else if (user.expired > 0 && user.expired < now) {
                    premiumExpired += 1;
                }
            }

            if (user.afk?.status) afkTotal += 1;
        }

        const average = users.length ? totalLimit / users.length : 0;

        return {
            totalUsers: users.length,
            freeUsers,
            premiumUsers,
            premiumActive,
            premiumExpired,
            afkTotal,
            limits: {
                average,
                max: users.length ? maxLimit : 0,
                min: users.length ? minLimit : 0,
            },
        };
    }

    async resetUserLimits(limit: number): Promise<void> {
        for (const user of Object.values(this.store.users)) {
            if (user.role === "free" && user.userId.includes("@s.whatsapp.net")) {
                user.limit = limit;
            }
        }
        this.markDirty("users");
    }

    // ─── Group ───────────────────────────────────────────────────────────────

    async getGroup(groupId: string): Promise<GroupRecord | null> {
        const key = this.safeKey(groupId);
        return this.store.groups[key] ?? null;
    }

    async upsertGroup(groupId: string, groupData: any): Promise<GroupRecord> {
        const settings = groupData.settings ?? {};
        settings.antilink = settings.antilink ?? {};
        const key = this.safeKey(groupId);

        const merged: GroupRecord = {
            id: this.store.groups[key]?.id ?? this.newId(),
            groupId,
            subject: groupData.subject ?? "",
            subjectOwnerPn: groupData.subjectOwnerPn ?? null,
            addressingMode: groupData.addressingMode ?? null,
            size: groupData.size ?? groupData.participants?.length ?? 0,
            creation: groupData.creation ?? 0,
            owner: groupData.owner ?? null,
            ownerPn: groupData.ownerPn ?? null,
            owner_country_code: groupData.owner_country_code ?? null,
            desc: groupData.desc ?? null,
            descOwner: groupData.descOwner ?? null,
            descOwnerPn: groupData.descOwnerPn ?? null,
            descTime: groupData.descTime ?? null,
            linkedParent: groupData.linkedParent ?? null,
            joinApprovalMode: groupData.joinApprovalMode ?? false,
            restrict: groupData.restrict ?? false,
            announce: groupData.announce ?? false,
            isCommunity: groupData.isCommunity ?? false,
            isCommunityAnnounce: groupData.isCommunityAnnounce ?? false,
            memberAddMode: groupData.memberAddMode ?? true,
            participants: groupData.participants ?? [],
            ephemeralDuration: groupData.ephemeralDuration ?? 0,
            settings: {
                notify: settings.notify ?? DEFAULT_SETTINGS.notify,
                welcome: settings.welcome ?? DEFAULT_SETTINGS.welcome,
                welcomeMessage: settings.welcomeMessage ?? null,
                leave: settings.leave ?? DEFAULT_SETTINGS.leave,
                leaveMessage: settings.leaveMessage ?? null,
                mute: settings.mute ?? DEFAULT_SETTINGS.mute,
                antilink: {
                    status: settings.antilink.status ?? DEFAULT_SETTINGS.antilink.status,
                    mode: settings.antilink.mode ?? DEFAULT_SETTINGS.antilink.mode,
                    list: settings.antilink.list ?? DEFAULT_SETTINGS.antilink.list,
                },
                antibot: settings.antibot ?? DEFAULT_SETTINGS.antibot,
                banned: settings.banned ?? [],
            },
        };

        this.store.groups[key] = merged;
        this.markDirty("groups");
        return merged;
    }

    async updateGroup(groupId: string, data: any): Promise<GroupRecord> {
        if (data?.groupMetadata) {
            return this.upsertGroup(groupId, data.groupMetadata);
        }

        const groupKey = this.safeKey(groupId);
        const existing = this.store.groups[groupKey];
        if (!existing) throw new Error(`Group not found: ${groupId}`);

        const updatableKeys: Array<keyof GroupRecord> = [
            "subject",
            "subjectOwnerPn",
            "addressingMode",
            "size",
            "creation",
            "owner",
            "ownerPn",
            "owner_country_code",
            "desc",
            "descOwner",
            "descOwnerPn",
            "descTime",
            "linkedParent",
            "joinApprovalMode",
            "restrict",
            "announce",
            "isCommunity",
            "isCommunityAnnounce",
            "memberAddMode",
            "participants",
            "ephemeralDuration",
            "settings",
        ];

        for (const key of updatableKeys) {
            if (data[key] !== undefined) {
                (existing as any)[key] = data[key];
            }
        }
        this.markDirty("groups");
        return existing;
    }

    async updateGroupSettings(groupId: string, settings: Partial<GroupSettingsRecord>): Promise<GroupRecord> {
        const groupKey = this.safeKey(groupId);
        const existing = this.store.groups[groupKey];
        if (!existing) throw new Error(`Group not found: ${groupId}`);

        const settingKeys: Array<keyof GroupSettingsRecord> = [
            "notify",
            "welcome",
            "welcomeMessage",
            "leave",
            "leaveMessage",
            "mute",
            "antilink",
            "antibot",
            "banned",
        ];

        for (const key of settingKeys) {
            if (settings[key] !== undefined) {
                (existing.settings as any)[key] = settings[key];
            }
        }
        this.markDirty("groups");
        return existing;
    }

    async deleteGroup(groupId: string): Promise<GroupRecord> {
        const key = this.safeKey(groupId);
        const record = this.store.groups[key];
        if (!record) throw new Error(`Group not found: ${groupId}`);
        delete this.store.groups[key];
        this.markDirty("groups");
        return record;
    }

    async getGroupCount(filter?: GroupFilter): Promise<number> {
        if (!filter?.search) return Object.keys(this.store.groups).length;
        const s = filter.search.toLowerCase();
        return Object.values(this.store.groups).filter((g) =>
            g.subject.toLowerCase().includes(s)
        ).length;
    }

    async getAllGroups(): Promise<GroupRecord[]> {
        return Object.values(this.store.groups);
    }

    async findGroups(filter: GroupFilter): Promise<PaginatedResult<GroupRecord>> {
        let results = Object.values(this.store.groups);

        if (filter.search) {
            const s = filter.search.toLowerCase();
            results = results.filter((g) => g.subject.toLowerCase().includes(s));
        }

        const total = results.length;
        if (filter.skip) results = results.slice(filter.skip);
        if (filter.take) results = results.slice(0, filter.take);

        return { data: results, total };
    }

    async getGroupParticipantStats(): Promise<GroupParticipantStats> {
        const groups = Object.values(this.store.groups);
        let totalParticipants = 0;
        let activeGroups = 0;

        for (const group of groups) {
            const size = typeof group.size === "number"
                ? group.size
                : group.participants?.length ?? 0;
            totalParticipants += size;
            if (size > 0) activeGroups += 1;
        }

        return { totalParticipants, activeGroups };
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    async getAdminById(id: string): Promise<AdminRecord | null> {
        return Object.values(this.store.admins).find((a) => a.id === id) ?? null;
    }

    async findAdminByUsername(username: string): Promise<AdminRecord | null> {
        const key = this.safeKey(username);
        return this.store.admins[key] ?? null;
    }

    async findAdminByPhoneNumber(phoneNumber: string): Promise<AdminRecord | null> {
        return Object.values(this.store.admins).find((a) => a.phoneNumber === phoneNumber) ?? null;
    }

    async createAdmin(data: { phoneNumber: string; username: string; password: string }): Promise<AdminRecord> {
        const key = this.safeKey(data.username);
        if (this.store.admins[key]) throw new Error(`Admin already exists: ${data.username}`);

        const now = new Date();
        const record: AdminRecord = {
            id: this.newId(),
            phoneNumber: data.phoneNumber,
            username: data.username,
            password: data.password,
            lastActivity: now,
            createdAt: now,
            updatedAt: now,
        };

        this.store.admins[key] = record;
        this.markDirty("admins");
        return record;
    }

    async updateAdmin(id: string, data: Partial<AdminRecord>): Promise<AdminRecord> {
        const record = Object.values(this.store.admins).find((a) => a.id === id);
        if (!record) throw new Error(`Admin not found: ${id}`);

        Object.assign(record, data, { updatedAt: new Date() });
        this.markDirty("admins");
        return record;
    }

    async deleteAdmin(username: string): Promise<AdminRecord> {
        const key = this.safeKey(username);
        const record = this.store.admins[key];
        if (!record) throw new Error(`Admin not found: ${username}`);
        delete this.store.admins[key];
        this.markDirty("admins");
        return record;
    }

    async getAllAdmins(): Promise<SafeAdminRecord[]> {
        return Object.values(this.store.admins)
            .sort((a, b) => a.createdAt.toString().localeCompare(b.createdAt.toString()))
            .map(({ password: _p, ...safe }) => safe as SafeAdminRecord);
    }

    // ─── Session ─────────────────────────────────────────────────────────────

    async getSession(sessionId: string): Promise<SessionRecord | null> {
        const key = this.safeKey(sessionId);
        return this.store.sessions[key] ?? null;
    }

    async setSession(sessionId: string, session: string): Promise<SessionRecord> {
        const key = this.safeKey(sessionId);
        const record: SessionRecord = this.store.sessions[key] ?? {
            id: this.newId(),
            sessionId,
        };
        record.session = session;
        this.store.sessions[key] = record;
        this.markDirty("sessions");
        return record;
    }

    async deleteSession(sessionId: string): Promise<void> {
        const key = this.safeKey(sessionId);
        delete this.store.sessions[key];
        this.markDirty("sessions");
    }

    async clearSessions(): Promise<void> {
        this.store.sessions = {};
        this.markDirty("sessions");
    }
}
