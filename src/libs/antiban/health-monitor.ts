export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Weight added to the risk score for each event type */
const EVENT_WEIGHTS: Record<string, number> = {
    disconnect: 5,
    "403": 20,   // Forbidden
    "401": 30,   // Logged out
    "463": 40,   // Timelock
    sendFailed: 3,
};

/** Risk level thresholds */
const THRESHOLDS: Record<RiskLevel, number> = {
    low: 0,
    medium: 20,
    high: 50,
    critical: 80,
};

/** Natural decay: subtract this many points per minute when idle */
const DECAY_PER_MINUTE = 1;

export interface HealthStats {
    score: number;
    level: RiskLevel;
    paused: boolean;
    eventCounts: Record<string, number>;
}

export class HealthMonitor {
    private score = 0;
    private lastDecayTs = Date.now();
    private paused = false;
    private eventCounts: Record<string, number> = {};
    private autoPauseAt: RiskLevel;
    private onRiskChange?: (level: RiskLevel, score: number) => void;

    constructor(opts: {
        autoPauseAt?: RiskLevel;
        onRiskChange?: (level: RiskLevel, score: number) => void;
    } = {}) {
        this.autoPauseAt = opts.autoPauseAt ?? "high";
        this.onRiskChange = opts.onRiskChange;
    }

    recordEvent(event: string): void {
        this.applyDecay();
        const weight = EVENT_WEIGHTS[event] ?? 2;
        this.score = Math.min(100, this.score + weight);
        this.eventCounts[event] = (this.eventCounts[event] ?? 0) + 1;

        const level = this.computeLevel();
        if (this.onRiskChange) this.onRiskChange(level, this.score);

        if (!this.paused && this.shouldPause(level)) {
            this.paused = true;
        }
    }

    /** Call when a successful reconnect/send occurs to reduce risk slightly */
    recordSuccess(): void {
        this.applyDecay();
        this.score = Math.max(0, this.score - 2);
        if (this.paused && this.computeLevel() === "low") {
            this.paused = false;
        }
    }

    resume(): void {
        this.paused = false;
    }

    isPaused(): boolean {
        this.applyDecay();
        return this.paused;
    }

    getLevel(): RiskLevel {
        this.applyDecay();
        return this.computeLevel();
    }

    getStats(): HealthStats {
        this.applyDecay();
        return {
            score: Math.round(this.score),
            level: this.computeLevel(),
            paused: this.paused,
            eventCounts: { ...this.eventCounts },
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    private applyDecay(): void {
        const now = Date.now();
        const minutesElapsed = (now - this.lastDecayTs) / 60_000;
        if (minutesElapsed >= 1) {
            const decay = Math.floor(minutesElapsed) * DECAY_PER_MINUTE;
            this.score = Math.max(0, this.score - decay);
            this.lastDecayTs =
                now - ((minutesElapsed % 1) * 60_000);
            if (this.paused && this.computeLevel() === "low") {
                this.paused = false;
            }
        }
    }

    private computeLevel(): RiskLevel {
        if (this.score >= THRESHOLDS.critical) return "critical";
        if (this.score >= THRESHOLDS.high) return "high";
        if (this.score >= THRESHOLDS.medium) return "medium";
        return "low";
    }

    private shouldPause(level: RiskLevel): boolean {
        const order: RiskLevel[] = ["low", "medium", "high", "critical"];
        return (
            order.indexOf(level) >= order.indexOf(this.autoPauseAt)
        );
    }
}
