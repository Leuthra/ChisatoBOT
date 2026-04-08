import type { GroupRecord, ParticipantRecord, UserRecord } from "../../infrastructure/database/interfaces/types";
import { Chisato } from "./auth/client";
import { MessageSerialize } from "./serialize";
import { Group as GroupDatabaseType, User as UserDatabaseType } from "../../libs/database";
import { Client } from "../../libs";

declare type ConfigCommands = {
    name: string;
    alias: string[];
    usage?: string;
    category: string;
    description: string;
    cooldown?: number; // in seconds
    limit?: number;
    example?: string;
    isOwner?: boolean;
    isTeam?: boolean;
    isPrivate?: boolean;
    isPremium?: boolean;
    isGroup?: boolean;
    isGroupAdmin?: boolean;
    isGroupOwner?: boolean;
    isBotAdmin?: boolean;
    run: (args: CommandsObject) => unknown;
};

type CommandsObject = {
    Chisato?: Client;
    from?: string;
    sender?: string;
    args?: string[];
    arg?: string;
    query?: string;
    body?: string;
    prefix?: string;
    command?: ConfigCommands;
    pushName?: string;
    message?: MessageSerialize;
    blockList?: string[];
    botNumber?: string;
    botName?: string;
    isOwner?: boolean;
    isTeam?: boolean;
    isGroup?: boolean;
    isGroupAdmin?: boolean;
    isGroupOwner?: boolean;
    isBotAdmin?: boolean;
    Database?: Database;
    groupName?: string;
    groupDescription?: string;
    groupParticipants?: ParticipantRecord[];
    groupAdmins?: ParticipantRecord[];
    groupMetadata?: GroupRecord;
    groupSettingData?: GroupSetting;
    userMetadata?: UserRecord;
};

declare type Database = {
    Group: GroupDatabaseType;
    User: UserDatabaseType;
};

declare type GroupSetting = {
    notify: boolean;
    welcome: boolean;
    leave: boolean;
    mute: boolean;
    antilink: {
        status?: boolean;
        mode: "kick" | "delete";
        list: string[];
    };
    antibot: boolean;
    banned: string[];
};

declare type Commands = {
    cmd: ConfigCmd;
};

declare type ConfigSettings = {
    name: string;
    isGroup: boolean;
    isBotAdmin: boolean;
    run: (args: EventsObject) => unknown;
};

declare type EventsObject = {
    name?: string;
    time?: string;
    Chisato?: Client;
    from?: string;
    sender?: string;
    body?: string;
    prefix?: string;
    pushName?: string;
    message?: MessageSerialize;
    isOwner?: boolean;
    isGroup?: boolean;
    isGroupAdmin?: boolean;
    isGroupOwner?: boolean;
    isBotAdmin?: boolean;
    Database?: Database;
    groupName?: string;
};
