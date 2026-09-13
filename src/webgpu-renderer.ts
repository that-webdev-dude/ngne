import type { ImageAsset, Lease } from "./assets.js";
import type { Frame } from "./renderer.js";
import { ACQUIRE_IMAGE, CREATE_RENDERER, RENDERER_READY } from "./renderer-host.js";
import { WebGpuRuntime } from "./webgpu-runtime.js";

export type RendererStatus = "ready" | "recovering" | "failed" | "disposed";

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
    ): Promise<WebGPURenderer> {
        return this[CREATE_RENDERER](canvas, width, height, onError);
    }
    static async [CREATE_RENDERER](
        canvas: HTMLCanvasElement,
        width: number,
        height: number,
        onError: (error: unknown) => void,
        signal?: AbortSignal,
    ): Promise<WebGPURenderer> {
        const runtime = await WebGpuRuntime.create(canvas, width, height, onError, { signal });
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
    texture(
        id: string,
        source: ImageBitmap | HTMLCanvasElement,
        signal?: AbortSignal,
    ): Promise<void> {
        return this.#runtime.texture(id, source, signal);
    }
    [ACQUIRE_IMAGE](
        definition: ImageAsset,
        source: Lease<ImageBitmap>,
        signal: AbortSignal,
    ): Promise<() => void> {
        return this.#runtime.acquire(definition, source, signal);
    }
    [RENDERER_READY](): Promise<void> {
        return this.#runtime.ready();
    }
    render(frame: Frame, clear = 0x090e20): void {
        this.#runtime.render(frame, clear);
    }
    dispose(): void {
        this.#runtime.dispose();
    }
}
