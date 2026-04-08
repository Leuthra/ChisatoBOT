import crypto from "crypto";

export interface RateLimiterConfig {
    maxPerMinute: number;
    maxPerHour: number;
    maxPerDay: number;
    burstAllowance: number;
    newChatPenaltyMs: number;
    typingMsPerChar: number;
    minDelayMs: number;
    maxDelayMs: number;
}

export interface SendDecision {
    allowed: boolean;
    delayMs: number;
    reason?: string;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
    maxPerMinute: 8,
    maxPerHour: 200,
    maxPerDay: 1500,
    burstAllowance: 5,
    newChatPenaltyMs: 3000,
    typingMsPerChar: 30,
    minDelayMs: 800,
    maxDelayMs: 4000,
};

/** Box-Muller transform — produces value roughly in [0, 1] centred on 0.5 */
function gaussianRandom(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const n = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    // Map normal(0,1) → [0,1] centred on 0.5 with std ~0.15; clamp to [0,1]
    return Math.min(1, Math.max(0, n * 0.15 + 0.5));
}

export class RateLimiter {
    private cfg: RateLimiterConfig;

    /** Rolling timestamp windows */
    private minuteWindow: number[] = [];
    private hourWindow: number[] = [];
    private dayWindow: number[] = [];

    /** Known JIDs that have received at least one message this session */
    private knownJids: Set<string> = new Set();

    /** Identical-message detection: hash → timestamps within last hour */
    private recentHashes: Map<string, number[]> = new Map();

    /** How many messages have been sent since startup (for burst allowance) */
    private sessionCount = 0;

    constructor(cfg: Partial<RateLimiterConfig> = {}) {
        this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    }

    /** Compute how long to wait before sending this message */
    evaluate(jid: string, content: string): SendDecision {
        const now = Date.now();
        this.prune(now);

        // ── 1. Window limit checks ──────────────────────────────────────────
        if (this.minuteWindow.length >= this.cfg.maxPerMinute) {
            const oldest = this.minuteWindow[0];
            const waitMs = 60_000 - (now - oldest) + 100;
            return { allowed: false, delayMs: waitMs, reason: "rate:minute" };
        }
        if (this.hourWindow.length >= this.cfg.maxPerHour) {
            const oldest = this.hourWindow[0];
            const waitMs = 3_600_000 - (now - oldest) + 100;
            return { allowed: false, delayMs: waitMs, reason: "rate:hour" };
        }
        if (this.dayWindow.length >= this.cfg.maxPerDay) {
            const oldest = this.dayWindow[0];
            const waitMs = 86_400_000 - (now - oldest) + 100;
            return { allowed: false, delayMs: waitMs, reason: "rate:day" };
        }

        // ── 2. Burst allowance — first N messages get no delay ──────────────
        if (this.sessionCount < this.cfg.burstAllowance) {
            return { allowed: true, delayMs: 0 };
        }

        // ── 3. Identical message detection ──────────────────────────────────
        const hash = this.hashContent(content);
        const previousSends = this.recentHashes.get(hash) ?? [];
        if (previousSends.length >= 3) {
            // Seen this exact message 3+ times in the last hour — add extra delay
            return {
                allowed: true,
                delayMs: this.cfg.maxDelayMs * 2,
                reason: "duplicate:extra-delay",
            };
        }

        // ── 4. Delay calculation ─────────────────────────────────────────────
        let delayMs = this.gaussianDelay();

        // Typing simulation: scale by content length
        const typingDelay = Math.min(
            content.length * this.cfg.typingMsPerChar,
            3000
        );
        delayMs += typingDelay;

        // New-chat penalty
        if (!this.knownJids.has(jid)) {
            delayMs += this.cfg.newChatPenaltyMs;
        }

        return { allowed: true, delayMs };
    }

    /** Call after a successful send to record the event */
    record(jid: string, content: string): void {
        const now = Date.now();
        this.minuteWindow.push(now);
        this.hourWindow.push(now);
        this.dayWindow.push(now);
        this.knownJids.add(jid);
        this.sessionCount++;

        const hash = this.hashContent(content);
        const arr = this.recentHashes.get(hash) ?? [];
        arr.push(now);
        this.recentHashes.set(hash, arr);
    }

    getStats() {
        return {
            lastMinute: this.minuteWindow.length,
            lastHour: this.hourWindow.length,
            lastDay: this.dayWindow.length,
            sessionTotal: this.sessionCount,
            knownJids: this.knownJids.size,
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    private gaussianDelay(): number {
        const range = this.cfg.maxDelayMs - this.cfg.minDelayMs;
        return Math.round(this.cfg.minDelayMs + gaussianRandom() * range);
    }

    private hashContent(content: string): string {
        return crypto.createHash("sha256").update(content).digest("hex");
    }

    private prune(now: number): void {
        this.minuteWindow = this.minuteWindow.filter(
            (t) => now - t < 60_000
        );
        this.hourWindow = this.hourWindow.filter(
            (t) => now - t < 3_600_000
        );
        this.dayWindow = this.dayWindow.filter(
            (t) => now - t < 86_400_000
        );

        // Prune identical-message hashes older than 1 hour
        for (const [hash, times] of this.recentHashes.entries()) {
            const fresh = times.filter((t) => now - t < 3_600_000);
            if (fresh.length === 0) {
                this.recentHashes.delete(hash);
            } else {
                this.recentHashes.set(hash, fresh);
            }
        }
    }
}
