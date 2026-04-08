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
    PaginatedResult,
    SafeAdminRecord,
    SessionRecord,
    UserFilter,
    UserRecord,
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

    // ─── User ────────────────────────────────────────────────────────────────

    async getUser(userId: string): Promise<UserRecord | null> {
        return this.store.users[userId] ?? null;
    }

    async upsertUser(userId: string, name?: string | null, overrides?: Partial<UserRecord>): Promise<UserRecord> {
        const existing = this.store.users[userId];
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

        this.store.users[userId] = record;
        this.markDirty("users");
        return record;
    }

    async updateUser(userId: string, data: Partial<UserRecord>): Promise<UserRecord> {
        const existing = this.store.users[userId];
        if (!existing) throw new Error(`User not found: ${userId}`);

        Object.assign(existing, data);
        this.markDirty("users");
        return existing;
    }

    async deleteUser(userId: string): Promise<UserRecord> {
        const record = this.store.users[userId];
        if (!record) throw new Error(`User not found: ${userId}`);
        delete this.store.users[userId];
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
        return this.store.groups[groupId] ?? null;
    }

    async upsertGroup(groupId: string, groupData: any): Promise<GroupRecord> {
        const settings = groupData.settings ?? {};
        settings.antilink = settings.antilink ?? {};

        const merged: GroupRecord = {
            id: this.store.groups[groupId]?.id ?? this.newId(),
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

        this.store.groups[groupId] = merged;
        this.markDirty("groups");
        return merged;
    }

    async updateGroup(groupId: string, data: any): Promise<GroupRecord> {
        if (data?.groupMetadata) {
            return this.upsertGroup(groupId, data.groupMetadata);
        }

        const existing = this.store.groups[groupId];
        if (!existing) throw new Error(`Group not found: ${groupId}`);

        Object.assign(existing, data);
        this.markDirty("groups");
        return existing;
    }

    async updateGroupSettings(groupId: string, settings: Partial<GroupSettingsRecord>): Promise<GroupRecord> {
        const existing = this.store.groups[groupId];
        if (!existing) throw new Error(`Group not found: ${groupId}`);

        existing.settings = { ...existing.settings, ...settings } as GroupSettingsRecord;
        this.markDirty("groups");
        return existing;
    }

    async deleteGroup(groupId: string): Promise<GroupRecord> {
        const record = this.store.groups[groupId];
        if (!record) throw new Error(`Group not found: ${groupId}`);
        delete this.store.groups[groupId];
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

    // ─── Admin ───────────────────────────────────────────────────────────────

    async getAdminById(id: string): Promise<AdminRecord | null> {
        return Object.values(this.store.admins).find((a) => a.id === id) ?? null;
    }

    async findAdminByUsername(username: string): Promise<AdminRecord | null> {
        return this.store.admins[username] ?? null;
    }

    async findAdminByPhoneNumber(phoneNumber: string): Promise<AdminRecord | null> {
        return Object.values(this.store.admins).find((a) => a.phoneNumber === phoneNumber) ?? null;
    }

    async createAdmin(data: { phoneNumber: string; username: string; password: string }): Promise<AdminRecord> {
        if (this.store.admins[data.username]) throw new Error(`Admin already exists: ${data.username}`);

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

        this.store.admins[data.username] = record;
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
        const record = this.store.admins[username];
        if (!record) throw new Error(`Admin not found: ${username}`);
        delete this.store.admins[username];
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
        return this.store.sessions[sessionId] ?? null;
    }

    async setSession(sessionId: string, session: string): Promise<SessionRecord> {
        const record: SessionRecord = this.store.sessions[sessionId] ?? {
            id: this.newId(),
            sessionId,
        };
        record.session = session;
        this.store.sessions[sessionId] = record;
        this.markDirty("sessions");
        return record;
    }

    async deleteSession(sessionId: string): Promise<void> {
        delete this.store.sessions[sessionId];
        this.markDirty("sessions");
    }
}
