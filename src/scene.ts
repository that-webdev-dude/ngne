import { World, type WorldAccess } from "./ecs.js";
import { Assets, type Asset, type Lease } from "./assets.js";
import { Camera, Cleanup, immutable, Random, seedOf } from "./primitives.js";
import { emptyInput, type InputSnapshot } from "./input.js";
import type { Frame } from "./renderer.js";
import { inspectValue, type InspectionValue } from "./inspection.js";

/** Internal browser-host capability; deliberately absent from the package entry point. */
export const FAIL_GAME = Symbol("fail game");

export interface DisplaySnapshot {
    readonly width: number;
    readonly height: number;
    readonly pixelRatio: number;
}
export interface SceneEvent {
    readonly type: string;
    readonly [key: string]: unknown;
}
export interface StateAccess<S, C> {
    read(): Readonly<S>;
    dispatch(command: C): void;
}
export interface SceneCommands {
    set(candidate: PreparedScene): void;
    push(candidate: PreparedScene): void;
    pop(): void;
}
export interface SystemContext {
    readonly dt: number;
    readonly simulationTick: number;
    readonly input: InputSnapshot;
    readonly display: DisplaySnapshot;
    readonly world: WorldAccess;
    readonly camera: Camera;
    readonly events: readonly SceneEvent[];
    emit(event: SceneEvent): void;
    readonly scenes: SceneCommands;
}
export interface SceneDefinition {
    readonly id: string;
    readonly blocksUpdateBelow?: boolean;
    readonly assets?: readonly Asset<any>[];
    setup(scene: SceneSetup): void;
}
export interface SceneSetup {
    readonly world: WorldAccess;
    readonly camera: Camera;
    readonly assets: ReadonlyMap<string, unknown>;
    resource<T>(name: string, value: T, cleanup?: (value: T) => void): T;
    random(name: string): Random;
    system(
        update: (context: SystemContext) => void,
        options?: { runsDuringFreeze?: boolean },
    ): void;
    render(prepare: (frame: Frame, alpha: number) => void): void;
    resetInterpolation(action: () => void): void;
    state<S, C>(): StateAccess<S, C>;
    freeze(ticks: number): void;
    defer(cleanup: () => void): void;
}
export interface PreparedScene {
    release(): void;
}
class SceneCandidate {
    readonly handle: PreparedScene = Object.freeze({ release: () => this.release() });
    private status: "ready" | "used" | "released" = "ready";
    constructor(
        readonly owner: symbol,
        readonly definition: SceneDefinition,
        readonly key: string,
        readonly seed: number | undefined,
        private leases: Lease[],
        private onRelease: () => void = () => {},
    ) {}
    consume(owner: symbol) {
        if (owner !== this.owner || this.status !== "ready")
            throw new Error("Scene candidate is stale, consumed, or foreign");
        this.status = "used";
        return this.leases.splice(0);
    }
    release() {
        if (this.status !== "ready") return;
        this.status = "released";
        this.onRelease();
        const cleanup = new Cleanup();
        this.leases.splice(0).forEach((l) => cleanup.defer(() => l.release()));
        cleanup.dispose();
    }
}
export interface SceneInspection {
    readonly id: number;
    readonly definition: string;
    readonly key: string;
    readonly seed: number;
    readonly blocksUpdateBelow: boolean;
    readonly entityCount: number;
    readonly entityCapacity: number;
    readonly freezeRemaining: number;
}
export interface SceneStateInspection extends SceneInspection {
    readonly world: InspectionValue;
    readonly resources: InspectionValue;
    readonly random: InspectionValue;
    readonly camera: InspectionValue;
    readonly freezePending: number;
    readonly inbox: InspectionValue;
    readonly outbox: InspectionValue;
}
export interface GameInspection {
    readonly compatibility: string;
    readonly simulationTick: number;
    readonly rootSeed: number;
    readonly nextInstanceId: number;
    readonly state: InspectionValue;
    readonly scenes: readonly SceneStateInspection[];
}
class SceneInstance {
    readonly world = new World();
    readonly resources = new Map<string, unknown>();
    readonly randomStreams = new Map<string, Random>();
    readonly camera = new Camera();
    readonly cleanup = new Cleanup();
    readonly schedule: {
        update: (ctx: SystemContext) => void;
        runsDuringFreeze: boolean;
    }[] = [];
    inbox: readonly SceneEvent[] = Object.freeze([]);
    outbox: SceneEvent[] = [];
    freezeRemaining = 0;
    freezePending = 0;
    prepare: (frame: Frame, alpha: number) => void = () => {};
    resets: (() => void)[] = [];
    published = false;
    constructor(
        readonly id: number,
        readonly definition: SceneDefinition,
        readonly key: string,
        readonly seed: number,
    ) {
        this.cleanup.defer(() => this.world.dispose());
    }
    dispose() {
        this.published = false;
        this.cleanup.dispose();
    }
    inspect(): SceneInspection {
        return Object.freeze({
            id: this.id,
            definition: this.definition.id,
            key: this.key,
            seed: this.seed,
            blocksUpdateBelow: !!this.definition.blocksUpdateBelow,
            entityCount: this.world.size,
            entityCapacity: this.world.capacity,
            freezeRemaining: this.freezeRemaining,
        });
    }
    enumerate(): SceneStateInspection {
        return Object.freeze({
            ...this.inspect(),
            world: inspectValue(this.world.enumerate()),
            resources: inspectValue(Object.fromEntries(this.resources)),
            random: inspectValue(Object.fromEntries(
                [...this.randomStreams].map(([k, r]) => [k, r.state]),
            )),
            camera: inspectValue(this.camera),
            freezeRemaining: this.freezeRemaining,
            freezePending: this.freezePending,
            inbox: inspectValue(this.inbox),
            outbox: inspectValue(this.outbox),
        });
    }
}
export type Lifecycle =
    | "Stopped"
    | "Starting"
    | "Running"
    | "Stopping"
    | "Failed"
    | "Disposing"
    | "Disposed";
export interface GameOptions<S, C> {
    seed: number | string;
    state: S;
    transition: (state: Readonly<S>, command: C) => S;
    dt?: number;
    compatibility?: string;
    diagnostic?: (error: unknown) => void;
}
/** Headless orchestrator. BrowserGame owns platform services and delegates simulation here. */
export class Game<S = Record<string, never>, C = never> {
    readonly rootSeed: number;
    readonly assets = new Assets();
    readonly dt: number;
    #simulationTick = 0;
    #lifecycle: Lifecycle = "Stopped";
    private owner = Symbol("game");
    private stack: SceneInstance[] = [];
    private nextId = 1;
    private stateValue: Readonly<S>;
    private stateCommands: C[] = [];
    private commands: (
        | { type: "set" | "push"; candidate: PreparedScene }
        | { type: "pop" }
    )[] = [];
    private candidates = new Map<PreparedScene, SceneCandidate>();
    private preparations = new Set<AbortController>();
    private initialized = false;
    private busy = false;
    constructor(private options: GameOptions<S, C>) {
        if (typeof options.seed === "number" && !Number.isFinite(options.seed))
            throw new Error("Invalid root seed");
        this.rootSeed = seedOf(options.seed);
        this.stateValue = immutable(structuredClone(options.state));
        this.dt = options.dt ?? 1 / 60;
        if (!(this.dt > 0 && Number.isFinite(this.dt)))
            throw new Error("Invalid tick duration");
    }
    get state() {
        return this.stateValue;
    }
    get simulationTick(): number {
        return this.#simulationTick;
    }
    get lifecycle(): Lifecycle {
        return this.#lifecycle;
    }
    [FAIL_GAME](): void {
        this.#lifecycle = "Failed";
    }
    /** Fresh frozen summaries in stack order; compare ids across inspections. */
    get scenes(): readonly SceneInspection[] {
        return Object.freeze(this.stack.map((scene) => scene.inspect()));
    }
    report(error: unknown) {
        try {
            this.options.diagnostic?.(error);
        } catch {
            /* Diagnostics must not change simulation. */
        }
    }
    async prepare(
        definition: SceneDefinition,
        options: { key: string; seed?: number; signal?: AbortSignal },
    ): Promise<PreparedScene> {
        if (
            ["Failed", "Disposing", "Disposed", "Stopping"].includes(
                this.lifecycle,
            )
        )
            throw new Error("Cannot prepare in " + this.lifecycle);
        if (!definition.id || !options.key)
            throw new Error(
                "Scene identity and authored mount key are required",
            );
        if (
            options.seed !== undefined &&
            (!Number.isSafeInteger(options.seed) ||
                options.seed < 0 ||
                options.seed > 0xffffffff)
        )
            throw new Error("Scene seed must be uint32");
        const controller = new AbortController();
        this.preparations.add(controller);
        const cancel = () => controller.abort();
        options.signal?.addEventListener("abort", cancel, { once: true });
        if (options.signal?.aborted) controller.abort();
        const leases: Lease[] = [];
        try {
            // Each acquired lease is owned before the next await; rollback is deterministic.
            for (const asset of definition.assets ?? [])
                leases.push(
                    await this.assets.acquire(asset, controller.signal),
                );
            if (controller.signal.aborted)
                throw new Error("Scene preparation cancelled");
            const candidate = new SceneCandidate(
                this.owner,
                definition,
                options.key,
                options.seed,
                leases,
                () => this.candidates.delete(candidate.handle),
            );
            this.candidates.set(candidate.handle, candidate);
            return candidate.handle;
        } catch (e) {
            const errors: unknown[] = [e];
            for (const l of leases.reverse()) {
                try {
                    l.release();
                } catch (error) {
                    errors.push(error);
                }
            }
            throw new AggregateError(errors, "Scene preparation failed");
        } finally {
            this.preparations.delete(controller);
            options.signal?.removeEventListener("abort", cancel);
        }
    }
    private mount(handle: PreparedScene) {
        const candidate = this.candidates.get(handle);
        if (!candidate) throw new Error("Scene candidate is stale, consumed, or foreign");
        const leases = candidate.consume(this.owner);
        this.candidates.delete(handle);
        const scene = new SceneInstance(
            this.nextId++,
            candidate.definition,
            candidate.key,
            candidate.seed ??
                seedOf(this.rootSeed, candidate.definition.id, candidate.key),
        );
        leases.forEach((l) => scene.cleanup.defer(() => l.release()));
        let mounting = true;
        const setupOnly = () => {
            if (!mounting)
                throw new Error("Scene bindings are fixed after setup");
        };
        const setup: SceneSetup = {
            world: scene.world.access,
            camera: scene.camera,
            assets: new Map(leases.map((l) => [l.id, l.value])),
            resource: <T>(
                name: string,
                value: T,
                cleanup?: (value: T) => void,
            ) => {
                setupOnly();
                if (!name || scene.resources.has(name))
                    throw new Error("Invalid or duplicate resource: " + name);
                scene.resources.set(name, value);
                if (cleanup) scene.cleanup.defer(() => cleanup(value));
                return value;
            },
            random: (name) => {
                setupOnly();
                if (!name || scene.randomStreams.has(name))
                    throw new Error("Invalid or duplicate RNG stream: " + name);
                const rng = new Random(seedOf(scene.seed, name));
                scene.randomStreams.set(name, rng);
                return rng;
            },
            system: (update, options) => {
                setupOnly();
                scene.schedule.push({
                    update,
                    runsDuringFreeze: !!options?.runsDuringFreeze,
                });
            },
            render: (prepare) => {
                setupOnly();
                scene.prepare = prepare;
            },
            resetInterpolation: (action) => {
                setupOnly();
                scene.resets.push(action);
            },
            state: <T, D>() => {
                setupOnly();
                return {
                    read: () => this.stateValue as unknown as Readonly<T>,
                    dispatch: (command: D) => {
                        if (mounting || !scene.published || !this.busy)
                            throw new Error(
                                "State dispatch requires an active system update",
                            );
                        this.stateCommands.push(command as unknown as C);
                    },
                };
            },
            freeze: (ticks) => {
                if (!Number.isSafeInteger(ticks) || ticks <= 0)
                    throw new Error("Freeze requires positive integer ticks");
                if (!mounting && (!scene.published || !this.busy))
                    throw new Error("Freeze requires active update");
                scene.freezePending = Math.max(scene.freezePending, ticks);
            },
            defer: (action) => {
                setupOnly();
                scene.cleanup.defer(action);
            },
        };
        try {
            const result = scene.definition.setup(setup) as unknown;
            if (
                result &&
                typeof (result as Promise<void>).then === "function"
            ) {
                Promise.resolve(result).catch((e) => this.report(e));
                throw new Error("Scene setup must be synchronous");
            }
            mounting = false;
            scene.world.commit();
            scene.camera.cut();
            scene.resets.forEach((f) => f());
            scene.freezeRemaining = scene.freezePending;
            scene.freezePending = 0;
            Object.freeze(scene.schedule);
            scene.published = true;
            return scene;
        } catch (error) {
            mounting = false;
            try {
                scene.dispose();
            } catch (cleanupError) {
                throw new AggregateError(
                    [error, cleanupError],
                    "Private scene mount and cleanup failed",
                );
            }
            throw error;
        }
    }
    async start(
        initial?: PreparedScene,
        loop?: { start(): void; stop(): void },
    ) {
        if (this.lifecycle !== "Stopped")
            throw new Error("Cannot start in " + this.lifecycle);
        this.#lifecycle = "Starting";
        const cold = !this.initialized;
        let loopAttempted = false;
        try {
            if (cold) {
                if (!initial)
                    throw new Error("Initial prepared scene required");
                this.stack = [this.mount(initial)];
            }
            loopAttempted = true;
            loop?.start();
            this.initialized = true;
            this.#lifecycle = "Running";
        } catch (e) {
            const errors: unknown[] = [e];
            if (loopAttempted) {
                try {
                    loop?.stop();
                } catch (error) {
                    errors.push(error);
                }
            }
            if (cold) {
                for (const scene of this.stack.splice(0).reverse()) {
                    try {
                        scene.dispose();
                    } catch (error) {
                        errors.push(error);
                    }
                }
            }
            this.#lifecycle =
                !cold || errors.length > 1 || e instanceof AggregateError
                    ? "Failed"
                    : "Stopped";
            if (errors.length > 1)
                throw new AggregateError(errors, "Startup rollback failed");
            throw e;
        }
    }
    private cancelPending() {
        const cleanup = new Cleanup();
        for (const controller of this.preparations)
            cleanup.defer(() => controller.abort());
        for (const candidate of this.candidates.values())
            cleanup.defer(() => candidate.release());
        this.candidates.clear();
        this.commands.length = 0;
        cleanup.dispose();
    }
    stop() {
        if (this.lifecycle === "Stopped") return;
        if (this.lifecycle !== "Running")
            throw new Error("Cannot stop in " + this.lifecycle);
        this.#lifecycle = "Stopping";
        try {
            this.cancelPending();
            this.#lifecycle = "Stopped";
        } catch (e) {
            this.#lifecycle = "Failed";
            throw e;
        }
    }
    /** Queue an already prepared candidate. It publishes only at a tick boundary. */
    set(candidate: PreparedScene) {
        this.enqueue({ type: "set", candidate });
    }
    push(candidate: PreparedScene) {
        this.enqueue({ type: "push", candidate });
    }
    pop() {
        this.enqueue({ type: "pop" });
    }
    private enqueue(command: (typeof this.commands)[number]) {
        if (this.lifecycle !== "Running")
            throw new Error("Scene commands require Running");
        this.commands.push(command);
    }
    tick(
        input: InputSnapshot = emptyInput(),
        display: DisplaySnapshot = { width: 640, height: 360, pixelRatio: 1 },
    ) {
        if (this.lifecycle !== "Running") return;
        if (this.busy) throw new Error("Reentrant tick");
        this.busy = true;
        try {
            let first = 0;
            for (let i = this.stack.length - 1; i >= 0; i--)
                if (this.stack[i].definition.blocksUpdateBelow) {
                    first = i;
                    break;
                }
            const selected = this.stack.slice(first),
                ordinary = new Set<SceneInstance>();
            const scenes: SceneCommands = {
                set: (c) => this.set(c),
                push: (c) => this.push(c),
                pop: () => this.pop(),
            };
            for (const scene of selected) {
                if (!scene.freezeRemaining) {
                    ordinary.add(scene);
                    scene.camera.beginTick();
                }
                const ctx: SystemContext = Object.freeze({
                    dt: this.dt,
                    simulationTick: this.simulationTick,
                    input,
                    display,
                    world: scene.world.access,
                    camera: scene.camera,
                    events: scene.inbox,
                    emit: (event: SceneEvent) => {
                        if (scene.freezeRemaining)
                            throw new Error(
                                "Gameplay events cannot emit during freeze",
                            );
                        scene.outbox.push(immutable(structuredClone(event)));
                    },
                    scenes,
                });
                for (const system of scene.schedule)
                    if (!scene.freezeRemaining || system.runsDuringFreeze) {
                        const result = system.update(ctx) as unknown;
                        if (
                            result &&
                            typeof (result as Promise<void>).then === "function"
                        ) {
                            Promise.resolve(result).catch((e) =>
                                this.report(e),
                            );
                            throw new Error("Systems must be synchronous");
                        }
                    }
            }
            for (const scene of selected) scene.world.commit();
            for (const scene of ordinary) {
                scene.inbox = Object.freeze(scene.outbox);
                scene.outbox = [];
            }
            for (const scene of selected) {
                if (scene.freezePending && !scene.freezeRemaining) {
                    scene.camera.cut();
                    scene.resets.forEach((f) => f());
                }
                scene.freezeRemaining = Math.max(
                    0,
                    scene.freezeRemaining - 1,
                    scene.freezePending,
                );
                scene.freezePending = 0;
            }
            for (const command of this.stateCommands)
                this.stateValue = immutable(
                    this.options.transition(this.stateValue, command),
                );
            this.stateCommands.length = 0;
            const commands = this.commands.splice(0);
            for (let i = 0; i < commands.length; i++) {
                const command = commands[i];
                try {
                    if (command.type === "pop") {
                        const old = this.stack.pop();
                        if (old) {
                            try {
                                old.dispose();
                            } catch (e) {
                                this.report(e);
                            }
                        }
                    } else {
                        const fresh = this.mount(command.candidate);
                        if (command.type === "set") {
                            const old = this.stack;
                            this.stack = [fresh];
                            for (const s of old.reverse()) {
                                try {
                                    s.dispose();
                                } catch (e) {
                                    this.report(e);
                                }
                            }
                        } else this.stack.push(fresh);
                    }
                } catch (e) {
                    this.report(e);
                    for (const later of commands.slice(i + 1))
                        if (later.type !== "pop") {
                            try {
                                later.candidate.release();
                                this.candidates.delete(later.candidate);
                            } catch (error) {
                                this.report(error);
                            }
                        }
                    break;
                }
            }
            this.#simulationTick++;
        } catch (e) {
            this.#lifecycle = "Failed";
            this.report(e);
            throw e;
        } finally {
            this.busy = false;
        }
    }
    render(frame: Frame, alpha: number) {
        if (this.lifecycle !== "Running") return;
        for (const scene of this.stack) {
            frame.scene(scene.camera, alpha);
            scene.prepare(frame, alpha);
        }
    }
    /** Detached frozen enumerable data; call on demand, not in the frame hot path. */
    enumerate(): GameInspection {
        return Object.freeze({
            compatibility:
                "NGNE/1;mulberry32/1;" +
                (this.options.compatibility ?? "unversioned-game"),
            simulationTick: this.simulationTick,
            rootSeed: this.rootSeed,
            nextInstanceId: this.nextId,
            state: inspectValue(this.stateValue),
            scenes: Object.freeze(this.stack.map((s) => s.enumerate())),
        });
    }
    dispose() {
        if (this.lifecycle === "Disposed") return;
        this.#lifecycle = "Disposing";
        const cleanup = new Cleanup();
        cleanup.defer(() => this.assets.dispose());
        for (const s of this.stack) cleanup.defer(() => s.dispose());
        this.stack = [];
        cleanup.defer(() => this.cancelPending());
        this.stateCommands.length = 0;
        try {
            cleanup.dispose();
        } finally {
            this.stateValue = undefined as S;
            this.#lifecycle = "Disposed";
        }
    }
}
