import {
    Game, FAIL_GAME,
    type GameOptions,
    type PreparedScene,
    type DisplaySnapshot,
} from "./scene.js";
import { Frame, Renderer } from "./renderer.js";
import { FixedStep } from "./primitives.js";
import { Input } from "./input.js";
import { Audio } from "./audio.js";
export interface FrameScheduler {
    request(callback: FrameRequestCallback): number;
    cancel(id: number): void;
}
export interface BrowserOptions<S, C> extends GameOptions<S, C> {
    canvas: HTMLCanvasElement;
    width?: number;
    height?: number;
    maxTicks?: number;
    clear?: number;
    scheduler?: FrameScheduler;
    afterFrame?: (stats: Readonly<Stats>) => void;
}
export interface Stats {
    fps: number;
    frameMs: number;
    updateMs: number;
    renderMs: number;
    sprites: number;
    drawCalls: number;
    droppedTicks: number;
}
export class BrowserGame<S, C> {
    readonly game: Game<S, C>;
    readonly input = new Input();
    readonly audio = new Audio();
    readonly frame = new Frame();
    readonly stats: Stats = {
        fps: 60,
        frameMs: 0,
        updateMs: 0,
        renderMs: 0,
        sprites: 0,
        drawCalls: 0,
        droppedTicks: 0,
    };
    renderer?: Renderer;
    private loop: FixedStep;
    private raf = 0;
    private last = 0;
    private enabled = false;
    private attached = false;
    private operation?: "start" | "stop";
    private disposed = false;
    private disposal?: Promise<void>;
    private run = 0;
    readonly width: number;
    readonly height: number;
    private scheduler: FrameScheduler;
    constructor(private options: BrowserOptions<S, C>) {
        this.game = new Game(options);
        this.width = options.width ?? 640;
        this.height = options.height ?? 360;
        if (
            !Number.isSafeInteger(this.width) ||
            this.width <= 0 ||
            !Number.isSafeInteger(this.height) ||
            this.height <= 0
        )
            throw new Error("Invalid display dimensions");
        this.loop = new FixedStep(this.game.dt, options.maxTicks ?? 5);
        this.scheduler = options.scheduler ?? {
            request: (callback) => requestAnimationFrame(callback),
            cancel: (id) => cancelAnimationFrame(id),
        };
    }
    private frameCallback = (now: number, run: number, callback: FrameRequestCallback) => {
        if (!this.enabled || run !== this.run) return;
        try {
            const elapsed = this.last ? (now - this.last) / 1000 : 0;
            this.last = now;
            const display: DisplaySnapshot = Object.freeze({
                width: this.width,
                height: this.height,
                pixelRatio: window.devicePixelRatio,
            });
            const begin = performance.now();
            const result = this.loop.advance(elapsed, () => {
                this.game.tick(this.input.consume(), display);
                this.audio.flush();
            });
            const updated = performance.now();
            this.frame.reset();
            this.game.render(this.frame, result.alpha);
            this.renderer!.render(this.frame, this.options.clear);
            const end = performance.now();
            this.stats.fps +=
                ((elapsed ? 1 / elapsed : 60) - this.stats.fps) * 0.05;
            this.stats.frameMs = end - begin;
            this.stats.updateMs = updated - begin;
            this.stats.renderMs = end - updated;
            this.stats.sprites = this.renderer!.sprites;
            this.stats.drawCalls = this.renderer!.drawCalls;
            this.stats.droppedTicks += result.dropped;
            if (result.dropped)
                this.game.report({
                    type: "overload",
                    droppedTicks: result.dropped,
                });
            this.options.afterFrame?.(this.stats);
            if (this.enabled)
                this.raf = this.scheduler.request(callback);
        } catch (e) {
            this.enabled = false;
            this.game[FAIL_GAME]();
            this.game.report(e);
        }
    };
    async start(initial?: PreparedScene): Promise<void> {
        this.requireIdle();
        if (this.game.lifecycle !== "Stopped")
            throw new Error("Cannot start in " + this.game.lifecycle);
        this.operation = "start";
        const run = ++this.run;
        const callback: FrameRequestCallback = (time) => this.frameCallback(time, run, callback);
        const cold = !this.attached;
        try {
            if (cold) {
                this.renderer = new Renderer(
                    this.options.canvas,
                    this.width,
                    this.height,
                    (e) => this.game.report(e),
                );
                this.input.attach(this.options.canvas, this.width, this.height);
            } else await this.audio.resume();
            if (this.disposed) throw new Error("Start cancelled by disposal");
            this.loop.reset();
            this.last = 0;
            await this.game.start(initial, {
                start: () => {
                    this.raf = this.scheduler.request(callback);
                },
                stop: () => this.scheduler.cancel(this.raf),
            });
            if (this.disposed) throw new Error("Start cancelled by disposal");
            this.enabled = true;
            this.attached = true;
        } catch (e) {
            if (this.disposed) throw e;
            this.enabled = false;
            if (cold) {
                const errors: unknown[] = [e];
                try {
                    this.input.dispose();
                } catch (error) {
                    errors.push(error);
                }
                try {
                    this.renderer?.dispose();
                } catch (error) {
                    errors.push(error);
                }
                if (errors.length > 1) {
                    this.game[FAIL_GAME]();
                    throw new AggregateError(errors, "Browser startup rollback failed");
                }
            } else this.game[FAIL_GAME]();
            throw e;
        } finally {
            this.operation = undefined;
        }
    }
    async stop(): Promise<void> {
        this.requireIdle();
        if (!["Running", "Stopped"].includes(this.game.lifecycle))
            throw new Error("Cannot stop in " + this.game.lifecycle);
        this.operation = "stop";
        this.enabled = false;
        this.run++;
        const errors: unknown[] = [];
        try {
            try {
                this.scheduler.cancel(this.raf);
            } catch (e) {
                errors.push(e);
            }
            try {
                this.game.stop();
            } catch (e) {
                errors.push(e);
            }
            try {
                this.input.clear();
            } catch (e) {
                errors.push(e);
            }
            try {
                await this.audio.suspend();
            } catch (e) {
                errors.push(e);
            }
            if (errors.length) {
                if (!this.disposed) this.game[FAIL_GAME]();
                throw new AggregateError(errors, "Stop failed");
            }
        } finally {
            this.operation = undefined;
        }
    }
    dispose(): Promise<void> {
        if (this.disposal) return this.disposal;
        this.disposed = true;
        this.enabled = false;
        this.run++;
        // Start every independent teardown now; a pending audio close must not
        // keep the world, renderer or input alive.
        this.disposal = Promise.allSettled([
            () => this.scheduler.cancel(this.raf),
            () => this.game.dispose(),
            () => this.audio.dispose(),
            () => this.renderer?.dispose(),
            () => this.input.dispose(),
        ].map(async (action) => { await action(); })).then((results) => {
            const errors = results.flatMap((result) =>
                result.status === "rejected" ? [result.reason] : []);
            if (errors.length) throw new AggregateError(errors, "Dispose failed");
        });
        return this.disposal;
    }
    private requireIdle(): void {
        if (this.disposed) throw new Error("Browser game is disposed");
        if (this.operation)
            throw new Error("Lifecycle operation already pending: " + this.operation);
    }
}
