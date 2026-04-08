import type { AuthenticationCreds, SignalDataTypeMap, proto } from "@whiskeysockets/baileys";
import type { AuthState } from "../types/auth/auth";
import { databaseService } from "../infrastructure/database";

// Dynamic import cache for baileys
let baileysModule: any = null;

async function getBaileys() {
    if (!baileysModule) {
        // Use Function constructor to prevent TypeScript from transforming dynamic import
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        baileysModule = await dynamicImport("@whiskeysockets/baileys");
    }
    return baileysModule;
}

export const useMultiAuthState = async (
): Promise<AuthState> => {
    const fixFileName = (fileName: string): string =>
        fileName.replace(/\//g, "__")?.replace(/:/g, "-");

    const writeData = async (data: unknown, fileName: string) => {
        try {
            const baileys = await getBaileys();
            const { BufferJSON } = baileys;
            const sessionId = fixFileName(fileName);
            const session = JSON.stringify(data, BufferJSON.replacer);
            await databaseService.setSession(sessionId, session);
        } catch {}
    };

    const readData = async (fileName: string) => {
        try {
            const baileys = await getBaileys();
            const { BufferJSON } = baileys;
            const sessionId = fixFileName(fileName);
            const data = await databaseService.getSession(sessionId);
            if (!data?.session) return null;
            return JSON.parse(data.session, BufferJSON.reviver);
        } catch {
            return null;
        }
    };

    const removeData = async (fileName: string): Promise<void> => {
        try {
            const sessionId = fixFileName(fileName);
            await databaseService.deleteSession(sessionId);
        } catch {}
    };

    const baileys = await getBaileys();
    const { initAuthCreds, proto } = baileys;
    const creds: AuthenticationCreds =
        (await readData("creds")) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data: {
                        [_: string]: SignalDataTypeMap[typeof type];
                    } = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === "app-state-sync-key" && value)
                                value =
                                    proto.Message.AppStateSyncKeyData.fromObject(
                                        value
                                    );
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks: Promise<void>[] = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value: unknown = data[category][id];
                            const file = `${category}-${id}`;
                            tasks.push(
                                value
                                    ? writeData(value, file)
                                    : removeData(file)
                            );
                        }
                    }
                    try {
                        await Promise.all(tasks);
                    } catch {}
                },
            },
        },
        saveCreds: async (): Promise<void> => {
            try {
                await writeData(creds, "creds");
            } catch {}
        },
        clearState: async (): Promise<void> => {
            try {
                await databaseService.clearSessions();
            } catch {}
        },
    };
};

export const useSingleAuthState = async (
): Promise<AuthState> => {
    const KEY_MAP: { [T in keyof SignalDataTypeMap]: string } = {
        "pre-key": "preKeys",
        session: "sessions",
        "sender-key": "senderKeys",
        "app-state-sync-key": "appStateSyncKeys",
        "app-state-sync-version": "appStateVersions",
        "sender-key-memory": "senderKeyMemory",
        "device-list": "deviceLists",
        "lid-mapping": "lidMappings",
        "tctoken": "tcTokens",
    };

    const baileys = await getBaileys();
    const { BufferJSON, initAuthCreds, proto } = baileys;

    let creds: AuthenticationCreds;
    let keys: unknown = {};

    const storedCreds = await databaseService.getSession("creds");
    if (storedCreds && storedCreds.session) {
        const parsedCreds = JSON.parse(storedCreds.session, BufferJSON.reviver);
        creds = parsedCreds.creds as AuthenticationCreds;
        keys = parsedCreds.keys;
    } else {
        if (!storedCreds) await databaseService.setSession("creds", "");
        creds = initAuthCreds();
    }

    const saveCreds = async (): Promise<void> => {
        try {
            const session = JSON.stringify(
                { creds, keys },
                BufferJSON.replacer
            );
            await databaseService.setSession("creds", session);
        } catch {}
    };

    return {
        state: {
            creds,
            keys: {
                get: (type, ids) => {
                    const key = KEY_MAP[type];
                    return ids.reduce((dict: unknown, id) => {
                        const value: unknown = keys[key]?.[id];
                        if (value) {
                            if (type === "app-state-sync-key")
                                dict[id] =
                                    proto.Message.AppStateSyncKeyData.fromObject(
                                        value
                                    );
                            dict[id] = value;
                        }
                        return dict;
                    }, {});
                },
                set: async (data) => {
                    for (const _key in data) {
                        const key = KEY_MAP[_key as keyof SignalDataTypeMap];
                        keys[key] = keys[key] || {};
                        Object.assign(keys[key], data[_key]);
                    }
                    try {
                        await saveCreds();
                    } catch {}
                },
            },
        },
        saveCreds,
        clearState: async (): Promise<void> => {
            try {
                await databaseService.deleteSession("creds");
            } catch {}
        },
    };
};
