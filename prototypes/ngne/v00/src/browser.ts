import {
  Game,
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
  private frameCallback = (now: number) => {
    if (!this.enabled) return;
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
      this.stats.fps += ((elapsed ? 1 / elapsed : 60) - this.stats.fps) * 0.05;
      this.stats.frameMs = end - begin;
      this.stats.updateMs = updated - begin;
      this.stats.renderMs = end - updated;
      this.stats.sprites = this.renderer!.sprites;
      this.stats.drawCalls = this.renderer!.drawCalls;
      this.stats.droppedTicks += result.dropped;
      if (result.dropped)
        this.game.report({ type: "overload", droppedTicks: result.dropped });
      this.options.afterFrame?.(this.stats);
      if (this.enabled) this.raf = this.scheduler.request(this.frameCallback);
    } catch (e) {
      this.enabled = false;
      this.game.lifecycle = "Failed";
      this.game.report(e);
    }
  };
  async start(initial?: PreparedScene) {
    if (this.game.lifecycle !== "Stopped")
      throw new Error("Cannot start in " + this.game.lifecycle);
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
      this.loop.reset();
      this.last = 0;
      await this.game.start(initial, {
        start: () => {
          this.raf = this.scheduler.request(this.frameCallback);
        },
        stop: () => this.scheduler.cancel(this.raf),
      });
      this.enabled = true;
      this.attached = true;
    } catch (e) {
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
        if ((this.game.lifecycle as string) === "Running") this.game.stop();
        if (errors.length > 1) {
          this.game.lifecycle = "Failed";
          throw new AggregateError(errors);
        }
      } else this.game.lifecycle = "Failed";
      throw e;
    }
  }
  async stop() {
    this.enabled = false;
    const errors: unknown[] = [];
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
    this.input.clear();
    try {
      await this.audio.suspend();
    } catch (e) {
      errors.push(e);
    }
    if (errors.length) {
      this.game.lifecycle = "Failed";
      throw new AggregateError(errors, "Stop failed");
    }
  }
  async dispose() {
    this.enabled = false;
    const errors: unknown[] = [];
    for (const action of [
      () => this.scheduler.cancel(this.raf),
      () => this.game.dispose(),
      () => this.audio.dispose(),
      () => this.renderer?.dispose(),
      () => this.input.dispose(),
    ]) {
      try {
        await action();
      } catch (e) {
        errors.push(e);
      }
    }
    if (errors.length) throw new AggregateError(errors, "Dispose failed");
  }
}
