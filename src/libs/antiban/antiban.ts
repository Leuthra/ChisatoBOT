import { RateLimiter, RateLimiterConfig } from "./rate-limiter";
import { WarmUp } from "./warmup";
import { HealthMonitor, RiskLevel } from "./health-monitor";
import { Timelock } from "./timelock";

export interface AntiBanConfig {
    enabled: boolean;
    maxPerMinute: number;
    maxPerHour: number;
    maxPerDay: number;
    autoPauseAt: RiskLevel;
    /** Used only by WarmUp; WarmUp always starts a fresh ramp unless a state file exists */
    warmUpDays?: number;
}

const DEFAULT_CONFIG: AntiBanConfig = {
    enabled: true,
    maxPerMinute: 8,
    maxPerHour: 200,
    maxPerDay: 1500,
    autoPauseAt: "high",
};

export interface SendDecision {
    allowed: boolean;
    delayMs: number;
    reason?: string;
}

export class AntiBan {
    private cfg: AntiBanConfig;
    private rateLimiter: RateLimiter;
    private warmUp: WarmUp;
    private health: HealthMonitor;
    private timelock: Timelock;

    constructor(cfg: Partial<AntiBanConfig> = {}) {
        this.cfg = { ...DEFAULT_CONFIG, ...cfg };

        const rlCfg: Partial<RateLimiterConfig> = {
            maxPerMinute: this.cfg.maxPerMinute,
            maxPerHour: this.cfg.maxPerHour,
            maxPerDay: this.cfg.maxPerDay,
        };

        this.rateLimiter = new RateLimiter(rlCfg);
        this.warmUp = new WarmUp();
        this.health = new HealthMonitor({ autoPauseAt: this.cfg.autoPauseAt });
        this.timelock = new Timelock();
    }

    /**
     * Must be called BEFORE sending any message.
     * Returns a decision: if `allowed` is false the message should be
     * deferred or dropped. If `allowed` is true, wait `delayMs` before
     * actually calling `sendMessage`.
     */
    beforeSend(jid: string, content: string): SendDecision {
        if (!this.cfg.enabled) return { allowed: true, delayMs: 0 };

        // 1. Health check — are we paused?
        if (this.health.isPaused()) {
            return {
                allowed: false,
                delayMs: 0,
                reason: `health:paused:${this.health.getLevel()}`,
            };
        }

        // 2. Timelock check
        const timelockResult = this.timelock.beforeSend(jid);
        if (timelockResult.blocked) {
            return {
                allowed: false,
                delayMs: 0,
                reason: timelockResult.reason,
            };
        }

        // 3. Warm-up check
        const warmUpResult = this.warmUp.isAllowed();
        if (!warmUpResult.allowed) {
            return {
                allowed: false,
                delayMs: 0,
                reason: warmUpResult.reason,
            };
        }

        // 4. Rate-limiter check (also computes delay)
        const rlResult = this.rateLimiter.evaluate(jid, content);
        if (!rlResult.allowed) {
            return {
                allowed: false,
                delayMs: rlResult.delayMs,
                reason: rlResult.reason,
            };
        }

        return { allowed: true, delayMs: rlResult.delayMs };
    }

    /**
     * Must be called AFTER a message is successfully sent.
     */
    afterSend(jid: string, content: string): void {
        if (!this.cfg.enabled) return;
        this.rateLimiter.record(jid, content);
        this.warmUp.record();
        this.timelock.addKnownJid(jid);
        this.health.recordSuccess();
    }

    /**
     * Must be called when a send attempt fails.
     * @param errorCode HTTP-style status code (e.g. 403, 401, 463)
     */
    afterSendFailed(errorCode?: number): void {
        if (!this.cfg.enabled) return;
        const event = errorCode ? String(errorCode) : "sendFailed";
        this.health.recordEvent(event);
        if (errorCode === 463) {
            this.timelock.activate();
        }
    }

    /**
     * Call when the WhatsApp connection goes down.
     * @param statusCode The disconnect reason code
     */
    onDisconnect(statusCode?: number): void {
        if (!this.cfg.enabled) return;
        this.health.recordEvent("disconnect");
        if (statusCode === 403) this.health.recordEvent("403");
        if (statusCode === 401) this.health.recordEvent("401");
        if (statusCode === 463) {
            this.health.recordEvent("463");
            this.timelock.activate();
        }
    }

    /** Call when the WhatsApp connection is re-established. */
    onReconnect(): void {
        if (!this.cfg.enabled) return;
        this.health.recordSuccess();
    }

    /** Persist all stateful components to disk. */
    save(): void {
        this.warmUp.save();
        this.timelock.save();
    }

    /** Returns a combined snapshot of all sub-module stats. */
    getStats() {
        return {
            enabled: this.cfg.enabled,
            rateLimiter: this.rateLimiter.getStats(),
            warmUp: this.warmUp.getStats(),
            health: this.health.getStats(),
            timelock: this.timelock.getStats(),
        };
    }
}

/** Singleton instance — shared across the whole process */
let instance: AntiBan | null = null;

/**
 * Returns the process-wide singleton AntiBan instance.
 * The `cfg` parameter is only used on the FIRST call; subsequent calls return
 * the already-initialised instance regardless of the arguments passed.
 * To change the configuration at runtime use the `AntiBan` class directly.
 */
export function getAntiBan(cfg?: Partial<AntiBanConfig>): AntiBan {
    if (!instance) {
        instance = new AntiBan(cfg);
    }
    return instance;
}
