import type { ImageAsset, Lease } from "./assets.js";
import { createGpuContext, type GpuContext } from "./gpu-context.js";
import { createQuadRenderer, type QuadRenderer } from "./quad-renderer.js";
import type { Frame } from "./renderer.js";
import { uploadImage } from "./texture-assets.js";

interface ImageEntry {
    readonly id: string;
    readonly definition?: ImageAsset;
    readonly source: ImageBitmap;
    readonly releaseSource: () => void;
    refs: number;
    released: boolean;
}
interface Generation {
    readonly abort: AbortController;
    context?: GpuContext;
    quad?: QuadRenderer;
    white?: GPUTexture;
    readonly images: Map<ImageEntry, GPUTexture>;
    readonly uploads: Map<ImageEntry, Promise<void>>;
    /** Uncaptured device errors repeat per submission; report each message once per device. */
    readonly uncaptured: Set<string>;
    disposed: boolean;
}
/** Internal injected platform boundary; public declarations never expose GPU identifiers. */
export interface RendererPlatform {
    readonly gpu?: GPU;
    readonly signal?: AbortSignal;
    readonly snapshot?: (source: ImageBitmap | HTMLCanvasElement) => Promise<ImageBitmap>;
}

export class WebGpuRuntime {
    status: "initializing" | "ready" | "recovering" | "failed" | "disposed" = "initializing";
    drawCalls = 0;
    sprites = 0;
    private generation?: Generation;
    private pending?: Generation;
    private readiness: Promise<void> = Promise.resolve();
    private entries = new Map<string, ImageEntry>();
    private replacements = new Map<string, object>();
    private faults = new Set<string>();
    private failure?: Error;
    private readonly ownerAbort = () => {
        try {
            this.dispose();
        } catch (error) {
            this.report(error);
        }
    };
    private constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly width: number,
        private readonly height: number,
        private readonly diagnostic: (error: unknown) => void,
        private readonly platform: RendererPlatform,
    ) {}

    static async create(
        canvas: HTMLCanvasElement,
        width: number,
        height: number,
        diagnostic: (error: unknown) => void,
        platform: RendererPlatform = {},
    ): Promise<WebGpuRuntime> {
        if (
            !Number.isSafeInteger(width) ||
            width <= 0 ||
            !Number.isSafeInteger(height) ||
            height <= 0
        )
            throw new Error("Invalid WebGPU logical dimensions");
        platform.signal?.throwIfAborted();
        const runtime = new WebGpuRuntime(canvas, width, height, diagnostic, platform);
        platform.signal?.addEventListener("abort", runtime.ownerAbort, { once: true });
        runtime.readiness = runtime.initialize();
        try {
            await runtime.readiness;
            return runtime;
        } catch (error) {
            try {
                runtime.dispose();
            } catch (cleanup) {
                throw new AggregateError([error, cleanup], "WebGPU initialization cleanup failed");
            }
            throw error;
        }
    }
    private report(error: unknown): void {
        try {
            this.diagnostic(error);
        } catch {
            /* Diagnostic callbacks cannot affect simulation. */
        }
    }
    private assertAlive(): void {
        this.platform.signal?.throwIfAborted();
        if (this.status === "disposed") throw new Error("WebGPU renderer is disposed");
        if (this.status === "failed")
            throw this.failure ?? new Error("WebGPU renderer failed; reload required");
    }
    private assertGeneration(generation: Generation): void {
        this.assertAlive();
        generation.abort.signal.throwIfAborted();
        generation.context?.assertReady();
    }
    async ready(): Promise<void> {
        this.assertAlive();
        await this.readiness;
        this.assertAlive();
    }
    /** Internal diagnostics used by the sustained renderer harness. Stable until generation changes. */
    get stats(): Readonly<QuadRenderer["stats"]> | undefined {
        return this.generation?.quad?.stats;
    }

    private async initialize(): Promise<void> {
        const generation: Generation = {
            abort: new AbortController(),
            images: new Map(),
            uploads: new Map(),
            uncaptured: new Set(),
            disposed: false,
        };
        this.pending = generation;
        try {
            const context = await createGpuContext(
                this.canvas,
                generation.abort.signal,
                (message) => this.lost(generation, message),
                (error) => {
                    if (this.generation !== generation && this.pending !== generation) return;
                    const key =
                        typeof error === "object" && error !== null && "message" in error
                            ? String(error.message)
                            : String(error);
                    if (generation.uncaptured.has(key)) return;
                    generation.uncaptured.add(key);
                    this.report(error);
                },
                this.platform.gpu,
            );
            generation.context = context;
            this.assertGeneration(generation);
            const quad = await createQuadRenderer(context.device, context.format);
            generation.quad = quad;
            this.assertGeneration(generation);
            generation.white = context.device.createTexture({
                size: [1, 1],
                format: "rgba8unorm",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            context.device.queue.writeTexture(
                { texture: generation.white },
                new Uint8Array([255, 255, 255, 255]),
                {},
                [1, 1],
            );
            await quad.texture("", generation.white.createView());
            this.assertGeneration(generation);
            // Repeat after awaits: membership can change during source upload/recovery.
            for (;;) {
                let missing: ImageEntry | undefined;
                for (const entry of this.entries.values())
                    if (!generation.images.has(entry)) {
                        missing = entry;
                        break;
                    }
                if (!missing) break;
                try {
                    await this.ensureImage(generation, missing);
                } catch (error) {
                    if (!missing.released) throw error;
                }
                this.assertGeneration(generation);
            }
            this.generation = generation;
            this.pending = undefined;
            this.status = "ready";
        } catch (error) {
            if (this.pending === generation) this.pending = undefined;
            try {
                disposeGeneration(generation);
            } catch (cleanup) {
                throw new AggregateError([error, cleanup], "WebGPU generation cleanup failed");
            }
            throw error;
        }
    }
    private lost(generation: Generation, message: string): void {
        if (generation !== this.generation || this.status !== "ready") return;
        this.status = "recovering";
        this.generation = undefined;
        this.drawCalls = this.sprites = 0;
        this.readiness = (async () => {
            disposeGeneration(generation);
            await this.initialize();
        })().catch((error: unknown) => {
            if (this.status === "disposed") throw error;
            this.status = "failed";
            this.failure = new Error("WebGPU recovery failed. Reload to create a new renderer", {
                cause: new AggregateError(
                    [new Error("Device lost: " + message), error],
                    "Device replacement failed",
                ),
            });
            this.report(this.failure);
            throw this.failure;
        });
        void this.readiness.catch(() => {
            /* Failure is reported once; readiness consumers also receive it. */
        });
    }
    private async upload(
        generation: Generation,
        source: ImageBitmap,
    ): Promise<{ texture: GPUTexture; binding: GPUBindGroup }> {
        this.assertGeneration(generation);
        const { context, quad } = generation;
        if (!context || !quad) throw new Error("WebGPU generation is not initialized");
        const texture = await uploadImage(context.device, source);
        try {
            this.assertGeneration(generation);
            const binding = await quad.binding(texture.createView());
            this.assertGeneration(generation);
            return { texture, binding };
        } catch (error) {
            try {
                texture.destroy();
            } catch (cleanup) {
                throw new AggregateError([error, cleanup], "Texture rollback failed");
            }
            throw error;
        }
    }
    private ensureImage(generation: Generation, entry: ImageEntry): Promise<void> {
        if (generation.images.has(entry)) return Promise.resolve();
        const previous = generation.uploads.get(entry);
        if (previous) return previous;
        const upload = (async () => {
            if (entry.released) throw new Error("Image consumer released: " + entry.id);
            const result = await this.upload(generation, entry.source);
            try {
                this.assertGeneration(generation);
                if (entry.released || this.entries.get(entry.id) !== entry)
                    throw new Error("Image consumer released: " + entry.id);
                const quad = generation.quad;
                if (!quad) throw new Error("Missing quad renderer");
                quad.setTexture(entry.id, result.binding);
                generation.images.set(entry, result.texture);
            } catch (error) {
                try {
                    result.texture.destroy();
                } catch (cleanup) {
                    throw new AggregateError([error, cleanup], "Image publication rollback failed");
                }
                throw error;
            }
        })();
        generation.uploads.set(entry, upload);
        void upload
            .finally(() => {
                if (generation.uploads.get(entry) === upload) generation.uploads.delete(entry);
            })
            .catch(() => {
                /* The acquiring consumer/initialization owns this rejection. */
            });
        return upload;
    }
    private releaseEntry(entry: ImageEntry): void {
        if (entry.released) return;
        entry.released = true;
        const current = this.entries.get(entry.id) === entry;
        if (current) this.entries.delete(entry.id);
        const actions: (() => void)[] = [];
        for (const generation of [this.generation, this.pending]) {
            if (!generation) continue;
            const texture = generation.images.get(entry);
            generation.images.delete(entry);
            if (current) actions.push(() => generation.quad?.release(entry.id));
            if (texture) actions.push(() => texture.destroy());
        }
        actions.push(entry.releaseSource);
        runCleanup(actions, "Image release failed");
    }
    /** Takes ownership of the supplied retained source lease, including on failure. */
    async acquire(
        definition: ImageAsset,
        source: Lease<ImageBitmap>,
        signal: AbortSignal,
    ): Promise<() => void> {
        let entry: ImageEntry;
        try {
            this.assertAlive();
            signal.throwIfAborted();
            if (!definition.id || this.replacements.has(definition.id))
                throw new Error("Image ID is reserved or manually registered: " + definition.id);
            const previous = this.entries.get(definition.id);
            if (previous && previous.definition !== definition)
                throw new Error("Conflicting image identity: " + definition.id);
            if (previous) {
                source.release();
                entry = previous;
            } else {
                entry = {
                    id: definition.id,
                    definition,
                    source: source.value,
                    releaseSource: () => source.release(),
                    refs: 0,
                    released: false,
                };
                this.entries.set(entry.id, entry);
            }
        } catch (error) {
            source.release();
            throw error;
        }
        entry.refs++;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            signal.removeEventListener("abort", abort);
            if (--entry.refs === 0) this.releaseEntry(entry);
        };
        const abort = () => {
            try {
                release();
            } catch (error) {
                this.report(error);
            }
        };
        signal.addEventListener("abort", abort, { once: true });
        try {
            await abortable(
                (async () => {
                    for (;;) {
                        await this.ready();
                        signal.throwIfAborted();
                        const generation = this.generation;
                        // Loss can land between readiness and this read; join its recovery.
                        if (!generation) continue;
                        try {
                            await this.ensureImage(generation, entry);
                        } catch (error) {
                            if (this.status === "recovering" || generation !== this.generation)
                                continue;
                            throw error;
                        }
                        if (generation === this.generation && this.status === "ready") return;
                    }
                })(),
                signal,
            );
            signal.throwIfAborted();
            return release;
        } catch (error) {
            // A failed, unpublished upload is immediately retryable; older consumers retain only
            // their release token. An entry already drawn by other consumers stays live.
            if (
                this.entries.get(entry.id) === entry &&
                !signal.aborted &&
                !this.generation?.images.has(entry)
            )
                this.releaseEntry(entry);
            release();
            throw error;
        }
    }
    async texture(
        id: string,
        source: ImageBitmap | HTMLCanvasElement,
        signal?: AbortSignal,
    ): Promise<void> {
        this.assertAlive();
        signal?.throwIfAborted();
        if (!id || this.entries.get(id)?.definition)
            throw new Error("Texture ID is reserved or leased: " + id);
        const token = {};
        this.replacements.set(id, token);
        let snapshot: ImageBitmap | undefined;
        try {
            snapshot = await (this.platform.snapshot
                ? this.platform.snapshot(source)
                : createImageBitmap(source, {
                      premultiplyAlpha: "none",
                      colorSpaceConversion: "none",
                  }));
            for (;;) {
                this.assertAlive();
                signal?.throwIfAborted();
                if (this.replacements.get(id) !== token)
                    throw new Error("Texture replacement superseded: " + id);
                await this.ready();
                this.assertAlive();
                signal?.throwIfAborted();
                const generation = this.generation;
                if (!generation) continue;
                let result: { texture: GPUTexture; binding: GPUBindGroup };
                try {
                    result = await this.upload(generation, snapshot);
                } catch (error) {
                    if (this.status === "recovering" || generation !== this.generation) continue;
                    throw error;
                }
                let published = false;
                try {
                    this.assertAlive();
                    signal?.throwIfAborted();
                    if (this.replacements.get(id) !== token)
                        throw new Error("Texture replacement superseded: " + id);
                    if (generation !== this.generation || this.status !== "ready") continue;
                    const owned = snapshot;
                    const entry: ImageEntry = {
                        id,
                        source: owned,
                        releaseSource: () => owned.close(),
                        refs: 1,
                        released: false,
                    };
                    generation.quad?.setTexture(id, result.binding);
                    const previous = this.entries.get(id);
                    this.entries.set(id, entry);
                    generation.images.set(entry, result.texture);
                    snapshot = undefined;
                    published = true;
                    if (previous) this.releaseEntry(previous);
                    return;
                } finally {
                    if (!published) result.texture.destroy();
                }
            }
        } finally {
            if (this.replacements.get(id) === token) this.replacements.delete(id);
            snapshot?.close();
        }
    }
    render(frame: Frame, clear: number): void {
        this.drawCalls = this.sprites = 0;
        if (this.status !== "ready") return;
        const generation = this.generation;
        if (!generation?.quad || !generation.context) return;
        try {
            generation.quad.prepare(frame);
            const view = generation.context.acquire();
            const encoder = generation.context.device.createCommandEncoder();
            generation.quad.encode(encoder, view, frame, this.width, this.height, clear);
            generation.context.submit(encoder);
            this.drawCalls = generation.quad.stats.drawCalls;
            this.sprites = frame.count;
            this.faults.clear();
        } catch (error) {
            const key = error instanceof Error ? error.message : String(error);
            if (!this.faults.has(key)) {
                this.faults.add(key);
                this.report(error);
            }
        }
    }
    dispose(): void {
        if (this.status === "disposed") return;
        this.status = "disposed";
        this.drawCalls = this.sprites = 0;
        this.platform.signal?.removeEventListener("abort", this.ownerAbort);
        const generations = [this.generation, this.pending];
        for (const generation of generations)
            generation?.abort.abort(new Error("WebGPU initialization cancelled by disposal"));
        this.replacements.clear();
        const actions: (() => void)[] = [];
        for (const entry of this.entries.values()) actions.push(() => this.releaseEntry(entry));
        for (const generation of generations)
            if (generation) actions.push(() => disposeGeneration(generation));
        runCleanup(actions, "WebGPU disposal failed");
    }
}

function disposeGeneration(generation: Generation): void {
    // Partial async initialization may attach late allocations after a previous teardown.
    generation.disposed = true;
    generation.abort.abort(new Error("WebGPU generation cancelled"));
    const { quad, white, context } = generation;
    generation.quad = undefined;
    generation.white = undefined;
    generation.context = undefined;
    const textures = [...generation.images.values()];
    generation.images.clear();
    runCleanup(
        [
            () => quad?.dispose(),
            ...textures.map((texture) => () => texture.destroy()),
            () => white?.destroy(),
            () => context?.dispose(),
        ],
        "WebGPU generation disposal failed",
    );
}
function runCleanup(actions: readonly (() => void)[], message: string): void {
    const errors: unknown[] = [];
    for (const action of actions)
        try {
            action();
        } catch (error) {
            errors.push(error);
        }
    if (errors.length) throw new AggregateError(errors, message);
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}
