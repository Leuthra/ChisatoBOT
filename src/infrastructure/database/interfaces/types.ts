/**
 * Provider-agnostic domain types — these replace direct @prisma/client imports
 * throughout the codebase so that swapping DB adapters requires no command changes.
 */

export type UserRole = "free" | "premium";

export type AfkRecord = {
    status: boolean;
    reason?: string | null;
    since?: number | null;
};

export type LevelRecord = {
    level: number;
    xp: number;
    totalXp: number;
};

export type CommandUsageRecord = {
    command: string;
    count: number;
};

export type UserStatsRecord = {
    totalCommands: number;
    commandsUsed: CommandUsageRecord[];
    lastCommandTime?: number | null;
    joinedAt?: number | null;
};

export type UserRecord = {
    id: string;
    userId: string;
    name?: string | null;
    limit: number;
    role: UserRole;
    expired: number;
    isBanned: boolean;
    afk: AfkRecord;
    level?: LevelRecord | null;
    stats?: UserStatsRecord | null;
};

export type AntilinkMode = "kick" | "delete";

export type AntilinkRecord = {
    status?: boolean | null;
    mode: AntilinkMode;
    list: string[];
};

export type GroupSettingsRecord = {
    notify: boolean;
    welcome: boolean;
    welcomeMessage?: string | null;
    leave: boolean;
    leaveMessage?: string | null;
    mute: boolean;
    antilink: AntilinkRecord;
    antibot: boolean;
    banned: string[];
};

export type ParticipantRecord = {
    id?: string | null;
    admin?: string | null;
    lid?: string | null;
    phoneNumber?: string | null;
};

export type GroupRecord = {
    id: string;
    groupId: string;
    subject: string;
    subjectOwnerPn?: string | null;
    addressingMode?: string | null;
    size: number;
    creation: number;
    owner?: string | null;
    ownerPn?: string | null;
    owner_country_code?: string | null;
    desc?: string | null;
    descOwner?: string | null;
    descOwnerPn?: string | null;
    descTime?: number | null;
    linkedParent?: string | null;
    joinApprovalMode?: boolean | null;
    restrict: boolean;
    announce: boolean;
    isCommunity: boolean;
    isCommunityAnnounce: boolean;
    memberAddMode: boolean;
    participants: ParticipantRecord[];
    ephemeralDuration?: number | null;
    settings: GroupSettingsRecord;
};

export type AdminRecord = {
    id: string;
    phoneNumber: string;
    username: string;
    password: string;
    lastActivity: Date;
    createdAt: Date;
    updatedAt: Date;
};

/** Safe admin record (no password) returned by list operations */
export type SafeAdminRecord = Omit<AdminRecord, "password">;

export type SessionRecord = {
    id: string;
    sessionId: string;
    session?: string | null;
};

/** Filter options for paginated user queries */
export type UserFilter = {
    role?: UserRole;
    isBanned?: boolean;
    /** Full-text search on userId and name */
    search?: string;
    skip?: number;
    take?: number;
};

/** Filter options for paginated group queries */
export type GroupFilter = {
    /** Full-text search on subject */
    search?: string;
    skip?: number;
    take?: number;
};

export type PaginatedResult<T> = {
    data: T[];
    total: number;
};

export type UserLimitStats = {
    average: number;
    max: number;
    min: number;
};

export type UserSummaryStats = {
    totalUsers: number;
    freeUsers: number;
    premiumUsers: number;
    premiumActive: number;
    premiumExpired: number;
    afkTotal: number;
    limits: UserLimitStats;
};

export type GroupParticipantStats = {
    totalParticipants: number;
    activeGroups: number;
};
