import fs from "fs";
import path from "path";

/**
 * Daily send limits for the warm-up period.
 * Index 0 = day 1, index 1 = day 2, …
 * After index 6 (day 7+) there is no artificial cap.
 */
const DAILY_LIMITS = [20, 36, 65, 117, 210, 378, 680];
const INACTIVITY_RESET_MS = 72 * 60 * 60 * 1000; // 72 hours

const STATE_FILE = path.join(process.cwd(), "warmup-state.json");

interface WarmUpState {
    startDate: string; // ISO date string
    lastSendDate: string | null;
    todayCount: number;
    lastCountDate: string | null; // YYYY-MM-DD of the last count reset
}

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export class WarmUp {
    private state: WarmUpState;

    constructor() {
        this.state = this.load();
    }

    /** Returns true when the current message is within the warm-up limit. */
    isAllowed(): { allowed: boolean; reason?: string } {
        const nowMs = Date.now();

        // Inactivity reset: if last send was >72 h ago, restart warm-up
        if (this.state.lastSendDate) {
            const lastMs = new Date(this.state.lastSendDate).getTime();
            if (nowMs - lastMs > INACTIVITY_RESET_MS) {
                this.restart();
            }
        }

        const elapsedDays = this.elapsedDays();
        if (elapsedDays >= DAILY_LIMITS.length) {
            // Past warm-up period — no limit applied
            return { allowed: true };
        }

        const limit = DAILY_LIMITS[elapsedDays];
        this.resetCounterIfNewDay();

        if (this.state.todayCount >= limit) {
            return {
                allowed: false,
                reason: `warmup:day${elapsedDays + 1}:limit:${limit}`,
            };
        }

        return { allowed: true };
    }

    /** Record a successful send. Must be called after every outbound message. */
    record(): void {
        this.resetCounterIfNewDay();
        this.state.todayCount++;
        this.state.lastSendDate = new Date().toISOString();
        this.save();
    }

    /** Persist state to disk. */
    save(): void {
        try {
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
        } catch {
            // Non-fatal — state will be reconstructed on next run
        }
    }

    getStats() {
        const elapsedDays = this.elapsedDays();
        const limit =
            elapsedDays < DAILY_LIMITS.length
                ? DAILY_LIMITS[elapsedDays]
                : null;
        return {
            startDate: this.state.startDate,
            elapsedDays,
            todayCount: this.state.todayCount,
            dailyLimit: limit,
            warmUpActive: elapsedDays < DAILY_LIMITS.length,
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    private elapsedDays(): number {
        const start = new Date(this.state.startDate).getTime();
        const nowMs = Date.now();
        return Math.floor((nowMs - start) / 86_400_000);
    }

    private resetCounterIfNewDay(): void {
        const today = todayKey();
        if (this.state.lastCountDate !== today) {
            this.state.todayCount = 0;
            this.state.lastCountDate = today;
        }
    }

    private restart(): void {
        this.state.startDate = new Date().toISOString();
        this.state.todayCount = 0;
        this.state.lastCountDate = todayKey();
        this.save();
    }

    private load(): WarmUpState {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const raw = fs.readFileSync(STATE_FILE, "utf-8");
                return JSON.parse(raw) as WarmUpState;
            }
        } catch {
            // Fall through to default
        }
        const now = new Date().toISOString();
        return {
            startDate: now,
            lastSendDate: null,
            todayCount: 0,
            lastCountDate: todayKey(),
        };
    }
}
