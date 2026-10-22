import type { ImageAsset, Lease } from "./assets.js";
import type { Frame } from "./renderer.js";
import { ACQUIRE_IMAGE, CREATE_RENDERER, RENDERER_READY } from "./renderer-host.js";
import { WebGpuRuntime } from "./webgpu-runtime.js";
import type { RendererResourceInspection } from "./resource-inspection.js";

export type RendererStatus = "ready" | "recovering" | "failed" | "disposed";
export type RendererLifecycleEvent =
    | { readonly status: "recovering" | "ready" }
    | { readonly status: "failed"; readonly error: Error };

/** GPU-free public declaration boundary; resources live in the private runtime. */
export class WebGPURenderer {
    #runtime: WebGpuRuntime;
    private constructor(
        readonly canvas: HTMLCanvasElement,
        readonly width: number,
        readonly height: number,
        runtime: WebGpuRuntime,
    ) {
        this.#runtime = runtime;
    }

    static create(
        canvas: HTMLCanvasElement,
        width: number,
        height: number,
        onError: (error: unknown) => void = console.error,
        signal?: AbortSignal,
    ): Promise<WebGPURenderer> {
        return this[CREATE_RENDERER](canvas, width, height, onError, signal);
    }
    static async [CREATE_RENDERER](
        canvas: HTMLCanvasElement,
        width: number,
        height: number,
        onError: (error: unknown) => void,
        signal?: AbortSignal,
    ): Promise<WebGPURenderer> {
        const runtime = await WebGpuRuntime.create(canvas, width, height, onError, { signal });
        if (signal?.aborted) {
            runtime.dispose();
            signal.throwIfAborted();
        }
        return new WebGPURenderer(canvas, width, height, runtime);
    }
    get status(): RendererStatus {
        const status = this.#runtime.status;
        if (status === "initializing") throw new Error("Renderer is not initialized");
        return status;
    }
    get drawCalls(): number {
        return this.#runtime.drawCalls;
    }
    get sprites(): number {
        return this.#runtime.sprites;
    }
    inspect(limit = 100): RendererResourceInspection {
        return this.#runtime.inspect(limit);
    }
    texture(
        id: string,
        source: ImageBitmap | HTMLCanvasElement,
        signal?: AbortSignal,
    ): Promise<void> {
        return this.#runtime.texture(id, source, signal);
    }
    releaseTexture(id: string): void {
        this.#runtime.releaseTexture(id);
    }
    [ACQUIRE_IMAGE](
        definition: ImageAsset,
        source: Lease<ImageBitmap>,
        signal: AbortSignal,
    ): Promise<() => void> {
        return this.#runtime.acquire(definition, source, signal);
    }
    [RENDERER_READY](): Promise<void> {
        return this.ready();
    }
    ready(signal?: AbortSignal): Promise<void> {
        return this.#runtime.ready(signal);
    }
    onLifecycle(observer: (event: RendererLifecycleEvent) => void): () => void {
        return this.#runtime.onLifecycle(observer);
    }
    render(frame: Frame, clear = 0x090e20): void {
        this.#runtime.render(frame, clear);
    }
    dispose(): void {
        this.#runtime.dispose();
    }
}
