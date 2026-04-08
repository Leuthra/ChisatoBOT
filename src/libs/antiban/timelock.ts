import fs from "fs";
import path from "path";

const STATE_FILE = path.join(process.cwd(), "timelock-state.json");
const DEFAULT_LOCK_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

interface TimelockState {
    locked: boolean;
    lockedAt: string | null;   // ISO timestamp
    expiresAt: string | null;  // ISO timestamp
}

export class Timelock {
    private state: TimelockState;
    /** JIDs that had at least one successful message before the lock */
    private knownJids: Set<string> = new Set();

    constructor() {
        this.state = this.load();
    }

    /** Record a JID as a known contact (should be called after every successful send) */
    addKnownJid(jid: string): void {
        this.knownJids.add(jid);
    }

    /**
     * Checks whether the send to `jid` should be blocked.
     * While timelocked, only known contacts may receive messages.
     */
    beforeSend(jid: string): { blocked: boolean; reason?: string } {
        if (!this.isActive()) {
            return { blocked: false };
        }
        if (this.knownJids.has(jid)) {
            return { blocked: false };
        }
        return {
            blocked: true,
            reason: `timelock:active:new-contact:expires:${this.state.expiresAt}`,
        };
    }

    /** Activate the timelock. Optionally pass the expiry duration in ms. */
    activate(durationMs: number = DEFAULT_LOCK_DURATION_MS): void {
        const now = new Date();
        this.state = {
            locked: true,
            lockedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + durationMs).toISOString(),
        };
        this.save();
    }

    /** Manually lift the timelock */
    lift(): void {
        this.state = { locked: false, lockedAt: null, expiresAt: null };
        this.save();
    }

    /** Alias for lift() — full reset */
    reset(): void {
        this.lift();
    }

    isActive(): boolean {
        if (!this.state.locked || !this.state.expiresAt) return false;
        if (Date.now() >= new Date(this.state.expiresAt).getTime()) {
            this.lift();
            return false;
        }
        return true;
    }

    save(): void {
        try {
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
        } catch {
            // Non-fatal
        }
    }

    getStats() {
        return {
            locked: this.isActive(),
            lockedAt: this.state.lockedAt,
            expiresAt: this.state.expiresAt,
            knownJids: this.knownJids.size,
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    private load(): TimelockState {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const raw = fs.readFileSync(STATE_FILE, "utf-8");
                return JSON.parse(raw) as TimelockState;
            }
        } catch {
            // Fall through
        }
        return { locked: false, lockedAt: null, expiresAt: null };
    }
}
