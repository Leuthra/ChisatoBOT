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
} from "./types";

export interface IUserRepository {
    getUser(userId: string): Promise<UserRecord | null>;
    upsertUser(userId: string, name?: string | null, overrides?: Partial<UserRecord>): Promise<UserRecord>;
    updateUser(userId: string, data: Partial<UserRecord>): Promise<UserRecord>;
    deleteUser(userId: string): Promise<UserRecord>;
    getUserCount(filter?: { role?: UserRole; isBanned?: boolean }): Promise<number>;
    getAllUsers(): Promise<UserRecord[]>;
    findUsers(filter: UserFilter): Promise<PaginatedResult<UserRecord>>;
    resetUserLimits(limit: number): Promise<void>;
}

export interface IGroupRepository {
    getGroup(groupId: string): Promise<GroupRecord | null>;
    upsertGroup(groupId: string, data: any): Promise<GroupRecord>;
    updateGroup(groupId: string, data: any): Promise<GroupRecord>;
    updateGroupSettings(groupId: string, settings: Partial<GroupSettingsRecord>): Promise<GroupRecord>;
    deleteGroup(groupId: string): Promise<GroupRecord>;
    getGroupCount(filter?: GroupFilter): Promise<number>;
    getAllGroups(): Promise<GroupRecord[]>;
    findGroups(filter: GroupFilter): Promise<PaginatedResult<GroupRecord>>;
}

export interface IAdminRepository {
    getAdminById(id: string): Promise<AdminRecord | null>;
    findAdminByUsername(username: string): Promise<AdminRecord | null>;
    findAdminByPhoneNumber(phoneNumber: string): Promise<AdminRecord | null>;
    createAdmin(data: { phoneNumber: string; username: string; password: string }): Promise<AdminRecord>;
    updateAdmin(id: string, data: Partial<AdminRecord>): Promise<AdminRecord>;
    deleteAdmin(username: string): Promise<AdminRecord>;
    getAllAdmins(): Promise<SafeAdminRecord[]>;
}

export interface ISessionRepository {
    getSession(sessionId: string): Promise<SessionRecord | null>;
    setSession(sessionId: string, session: string): Promise<SessionRecord>;
    deleteSession(sessionId: string): Promise<void>;
    clearSessions(): Promise<void>;
}
