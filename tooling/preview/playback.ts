import { duration, type Animation } from "./model.js";

/** Caller supplies a monotonic millisecond clock; callback counts have no timing meaning. */
export class Playback {
    elapsed = 0;
    playing = false;
    private previous = 0;
    readonly total: number;
    constructor(readonly animation: Animation) {
        this.total = duration(animation);
    }
    get index(): number {
        let end = 0;
        for (const [index, entry] of this.animation.entries.entries()) {
            end += entry.ms;
            if (this.elapsed < end) return index;
        }
        return this.animation.entries.length - 1;
    }
    play(now: number): void {
        if (this.playing) return;
        if (this.elapsed >= this.total) this.elapsed = 0;
        this.previous = now;
        this.playing = true;
    }
    advance(now: number): void {
        if (!this.playing) return;
        const delta = Math.max(0, now - this.previous);
        this.previous = now;
        if (this.animation.playback === "loop") {
            const remainder = delta % this.total;
            this.elapsed =
                remainder >= this.total - this.elapsed
                    ? remainder - (this.total - this.elapsed)
                    : this.elapsed + remainder;
        } else {
            this.elapsed = delta >= this.total - this.elapsed ? this.total : this.elapsed + delta;
            if (this.elapsed === this.total) this.playing = false;
        }
    }
    pause(now: number): void {
        this.advance(now);
        this.playing = false;
    }
    step(direction: -1 | 1): void {
        if (this.playing) return;
        const index = Math.max(
            0,
            Math.min(this.animation.entries.length - 1, this.index + direction),
        );
        // Clamping also resets the endpoint entry, including a completed once animation.
        this.elapsed = this.animation.entries
            .slice(0, index)
            .reduce((sum, entry) => sum + entry.ms, 0);
    }
}
