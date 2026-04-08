/**
 * MongoDB adapter — uses the existing Prisma client (default provider).
 * This is the production-ready adapter and requires no schema changes.
 */
import { PrismaClient } from "@prisma/client";
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

export class MongoDBAdapter implements IUserRepository, IGroupRepository, IAdminRepository, ISessionRepository {
    private prisma: PrismaClient;

    constructor(prisma?: PrismaClient) {
        this.prisma = prisma ?? new PrismaClient({ log: ["error"] });
    }

    getPrismaClient(): PrismaClient {
        return this.prisma;
    }

    async connect(): Promise<void> {
        await this.prisma.$connect();
    }

    async disconnect(): Promise<void> {
        await this.prisma.$disconnect();
    }

    // ─── User ────────────────────────────────────────────────────────────────

    async getUser(userId: string): Promise<UserRecord | null> {
        return this.prisma.user.findUnique({ where: { userId } }) as any;
    }

    async upsertUser(userId: string, name?: string | null, overrides?: Partial<UserRecord>): Promise<UserRecord> {
        const base = {
            userId,
            name: name ?? null,
            limit: 30,
            role: "free" as const,
            expired: 0,
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

        return this.prisma.user.upsert({
            where: { userId },
            create: base,
            update: { name: name ?? undefined },
        }) as any;
    }

    async updateUser(userId: string, data: Partial<UserRecord>): Promise<UserRecord> {
        return this.prisma.user.upsert({
            where: { userId },
            create: {
                userId,
                name: (data as any).name ?? null,
                limit: (data as any).limit ?? 30,
                role: ((data as any).role as any) ?? "free",
                expired: (data as any).expired ?? 0,
                afk: (data as any).afk ?? { status: false, reason: null, since: 0 },
                level: (data as any).level ?? { level: 1, xp: 0, totalXp: 0 },
                stats: (data as any).stats ?? {
                    totalCommands: 0,
                    commandsUsed: [],
                    lastCommandTime: 0,
                    joinedAt: Math.floor(Date.now() / 1000),
                },
            },
            update: data as any,
        }) as any;
    }

    async deleteUser(userId: string): Promise<UserRecord> {
        return this.prisma.user.delete({ where: { userId } }) as any;
    }

    async getUserCount(filter?: { role?: UserRole; isBanned?: boolean }): Promise<number> {
        const where: any = {};
        if (filter?.role) where.role = filter.role;
        if (filter?.isBanned !== undefined) where.isBanned = filter.isBanned;
        return this.prisma.user.count({ where });
    }

    async getAllUsers(): Promise<UserRecord[]> {
        return this.prisma.user.findMany() as any;
    }

    async findUsers(filter: UserFilter): Promise<PaginatedResult<UserRecord>> {
        const where: any = {};
        if (filter.role) where.role = filter.role;
        if (filter.isBanned !== undefined) where.isBanned = filter.isBanned;
        if (filter.search) {
            where.OR = [
                { userId: { contains: filter.search, mode: "insensitive" } },
                { name: { contains: filter.search, mode: "insensitive" } },
            ];
        }

        const [data, total] = await Promise.all([
            this.prisma.user.findMany({
                where,
                skip: filter.skip,
                take: filter.take,
            }),
            this.prisma.user.count({ where }),
        ]);

        return { data: data as any, total };
    }

    private afkCountFilter(): any {
        const provider = (process.env.DB_PROVIDER ?? "mongodb").toLowerCase();
        if (provider === "postgres" || provider === "sqlite") {
            return { afk: { path: ["status"], equals: true } };
        }
        return { afk: { is: { status: true } } };
    }

    async getUserSummaryStats(now: number): Promise<UserSummaryStats> {
        const [
            totalUsers,
            freeUsers,
            premiumUsers,
            premiumActive,
            premiumExpired,
            afkTotal,
            limitStats,
        ] = await Promise.all([
            this.prisma.user.count(),
            this.prisma.user.count({ where: { role: "free" as any } }),
            this.prisma.user.count({ where: { role: "premium" as any } }),
            this.prisma.user.count({
                where: {
                    role: "premium" as any,
                    OR: [{ expired: 0 }, { expired: { gt: now } }],
                },
            }),
            this.prisma.user.count({
                where: {
                    role: "premium" as any,
                    expired: { gt: 0, lt: now },
                },
            }),
            this.prisma.user.count({ where: this.afkCountFilter() }),
            this.prisma.user.aggregate({
                _avg: { limit: true },
                _min: { limit: true },
                _max: { limit: true },
            }),
        ]);

        return {
            totalUsers,
            freeUsers,
            premiumUsers,
            premiumActive,
            premiumExpired,
            afkTotal,
            limits: {
                average: limitStats._avg.limit ?? 0,
                max: limitStats._max.limit ?? 0,
                min: limitStats._min.limit ?? 0,
            },
        };
    }

    async resetUserLimits(limit: number): Promise<void> {
        await this.prisma.user.updateMany({
            where: { userId: { contains: "@s.whatsapp.net" }, role: { in: ["free"] } },
            data: { limit },
        });
    }

    // ─── Group ───────────────────────────────────────────────────────────────

    async getGroup(groupId: string): Promise<GroupRecord | null> {
        return this.prisma.group.findUnique({ where: { groupId } }) as any;
    }

    async upsertGroup(groupId: string, groupData: any): Promise<GroupRecord> {
        const settings = groupData.settings ?? {};
        settings.antilink = settings.antilink ?? {};

        const validData: any = {
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

        return this.prisma.group.upsert({
            where: { groupId },
            create: { groupId, ...validData },
            update: validData,
        }) as any;
    }

    async updateGroup(groupId: string, data: any): Promise<GroupRecord> {
        if (data?.groupMetadata) {
            return this.upsertGroup(groupId, data.groupMetadata);
        }

        const cleanData: any = {};
        for (const key in data) {
            if (data[key] !== undefined) cleanData[key] = data[key];
        }

        return this.prisma.group.update({ where: { groupId }, data: cleanData }) as any;
    }

    async updateGroupSettings(groupId: string, settings: Partial<GroupSettingsRecord>): Promise<GroupRecord> {
        return this.prisma.group.update({
            where: { groupId },
            data: { settings: { update: settings } } as any,
        }) as any;
    }

    async deleteGroup(groupId: string): Promise<GroupRecord> {
        return this.prisma.group.delete({ where: { groupId } }) as any;
    }

    async getGroupCount(filter?: GroupFilter): Promise<number> {
        const where: any = {};
        if (filter?.search) {
            where.subject = { contains: filter.search, mode: "insensitive" };
        }
        return this.prisma.group.count({ where });
    }

    async getAllGroups(): Promise<GroupRecord[]> {
        return this.prisma.group.findMany() as any;
    }

    async findGroups(filter: GroupFilter): Promise<PaginatedResult<GroupRecord>> {
        const where: any = {};
        if (filter.search) {
            where.subject = { contains: filter.search, mode: "insensitive" };
        }

        const [data, total] = await Promise.all([
            this.prisma.group.findMany({ where, skip: filter.skip, take: filter.take }),
            this.prisma.group.count({ where }),
        ]);

        return { data: data as any, total };
    }

    async getGroupParticipantStats(): Promise<GroupParticipantStats> {
        const [sumResult, activeGroups] = await Promise.all([
            this.prisma.group.aggregate({ _sum: { size: true } }),
            this.prisma.group.count({ where: { size: { gt: 0 } } }),
        ]);

        return {
            totalParticipants: sumResult._sum.size ?? 0,
            activeGroups,
        };
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    async getAdminById(id: string): Promise<AdminRecord | null> {
        return this.prisma.admin.findUnique({ where: { id } }) as any;
    }

    async findAdminByUsername(username: string): Promise<AdminRecord | null> {
        return this.prisma.admin.findUnique({ where: { username } }) as any;
    }

    async findAdminByPhoneNumber(phoneNumber: string): Promise<AdminRecord | null> {
        return this.prisma.admin.findFirst({ where: { phoneNumber } }) as any;
    }

    async createAdmin(data: { phoneNumber: string; username: string; password: string }): Promise<AdminRecord> {
        return this.prisma.admin.create({ data }) as any;
    }

    async updateAdmin(id: string, data: Partial<AdminRecord>): Promise<AdminRecord> {
        return this.prisma.admin.update({ where: { id }, data: data as any }) as any;
    }

    async deleteAdmin(username: string): Promise<AdminRecord> {
        return this.prisma.admin.delete({ where: { username } }) as any;
    }

    async getAllAdmins(): Promise<SafeAdminRecord[]> {
        return this.prisma.admin.findMany({
            select: { id: true, phoneNumber: true, username: true, lastActivity: true, createdAt: true, updatedAt: true },
            orderBy: { createdAt: "asc" },
        }) as any;
    }

    // ─── Session ─────────────────────────────────────────────────────────────

    async getSession(sessionId: string): Promise<SessionRecord | null> {
        return this.prisma.session.findUnique({ where: { sessionId } }) as any;
    }

    async setSession(sessionId: string, session: string): Promise<SessionRecord> {
        return this.prisma.session.upsert({
            where: { sessionId },
            create: { sessionId, session },
            update: { session },
        }) as any;
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.prisma.session.delete({ where: { sessionId } }).catch(() => void 0);
    }

    async clearSessions(): Promise<void> {
        await this.prisma.session.deleteMany({});
    }
}
