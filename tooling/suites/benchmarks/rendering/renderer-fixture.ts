import { Camera, Frame, type Sprite } from "../../../../src/index.js";
import { WebGpuRuntime } from "../../../../src/webgpu-runtime.js";

interface RendererBenchmark {
    readonly samples: Float64Array;
    count: number;
    readonly metadata: Record<string, unknown>;
    readonly metrics: {
        drawCalls: number;
        uploadBytes: number;
        capacity: number;
        bufferGrowths: number;
        bindings: number;
    };
    error: string;
}
declare global {
    interface Window {
        __ngneRendererBenchmark?: RendererBenchmark;
    }
}

/** Fixed renderer-only workload; no ECS/gameplay and no GPU completion wait in measured frames. */
export async function startRendererBenchmark(mode: string): Promise<void> {
    if (mode !== "webgpu") throw new Error("Unknown renderer benchmark mode");
    const alternating = new URLSearchParams(location.search).get("alternating") === "1";
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    canvas.style.cssText = "display:block;width:640px;height:360px;image-rendering:pixelated";
    document.body.prepend(canvas);
    const metadata: Record<string, unknown> = {
        mode,
        alternating,
        sprites: 10000,
        width: 640,
        height: 360,
        dpr: devicePixelRatio,
        browser: navigator.userAgent,
        secureContext: window.isSecureContext,
        visibility: document.visibilityState,
    };
    const metrics = {
        drawCalls: 0,
        uploadBytes: 560048,
        capacity: 0,
        bufferGrowths: 0,
        bindings: 3,
    };
    const diagnostics: string[] = [];
    const real = navigator.gpu;
    const gpu = new Proxy(real, {
        get(target, key) {
            if (key === "requestAdapter")
                return async (options?: GPURequestAdapterOptions) => {
                    const adapter = await target.requestAdapter(options);
                    if (adapter)
                        metadata.adapter = {
                            vendor: adapter.info.vendor,
                            architecture: adapter.info.architecture,
                            device: adapter.info.device,
                            description: adapter.info.description,
                            isFallbackAdapter: adapter.info.isFallbackAdapter,
                        };
                    return adapter;
                };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    metadata.format = real.getPreferredCanvasFormat();
    const renderer = await WebGpuRuntime.create(
        canvas,
        640,
        360,
        (error) => diagnostics.push(String(error)),
        { gpu },
    );
    const image = document.createElement("canvas");
    image.width = image.height = 2;
    const paint = image.getContext("2d");
    if (!paint) throw new Error("Canvas 2D unavailable");
    paint.fillStyle = "#60a0c0";
    paint.fillRect(0, 0, 2, 2);
    await renderer.texture("a", image);
    const imageB = document.createElement("canvas");
    imageB.width = imageB.height = 2;
    const paintB = imageB.getContext("2d");
    if (!paintB) throw new Error("Canvas 2D unavailable");
    paintB.fillStyle = "#c08040";
    paintB.fillRect(0, 0, 2, 2);
    await renderer.texture("b", imageB);
    const sample: RendererBenchmark = {
        samples: new Float64Array(60000 * 3),
        count: 0,
        metadata,
        metrics,
        error: "",
    };
    window.__ngneRendererBenchmark = sample;
    const frame = new Frame(),
        camera = new Camera();
    camera.pixelSnap = false;
    const sprite: Sprite = { x: 0, y: 0, width: 4, height: 4, alpha: 0.75, texture: "a" };
    let raf = 0,
        disposed = false;
    const tick = () => {
        if (disposed) return;
        try {
            const start = performance.now();
            frame.reset();
            frame.scene(camera, 1);
            for (let i = 0; i < 10000; i++) {
                sprite.x = (i % 160) * 4 + 2;
                sprite.y = (Math.floor(i / 160) % 90) * 4 + 2;
                sprite.texture = alternating && i % 2 ? "b" : "a";
                frame.sprite(sprite);
            }
            const prepared = performance.now();
            renderer.render(frame, 0x090e20);
            const submitted = performance.now();
            if (sample.count >= 60000)
                throw new Error("Renderer benchmark sample buffer exhausted");
            const offset = sample.count++ * 3;
            sample.samples[offset] = start;
            sample.samples[offset + 1] = prepared - start;
            sample.samples[offset + 2] = submitted - prepared;
            metrics.drawCalls = renderer.drawCalls;
            if (renderer.stats) {
                metrics.capacity = renderer.stats.capacity;
                metrics.bufferGrowths = renderer.stats.bufferGrowths;
                metrics.bindings = renderer.stats.bindings;
            }
            if (diagnostics.length) throw new Error(diagnostics.join("; "));
            document.body.dataset.rendererBenchmarkReady = "true";
            raf = requestAnimationFrame(tick);
        } catch (error) {
            sample.error = String(error);
            const output = document.getElementById("results");
            if (output) output.textContent = sample.error;
        }
    };
    const output = document.getElementById("results");
    if (output) output.textContent = JSON.stringify(metadata, null, 2);
    raf = requestAnimationFrame(tick);
    window.addEventListener(
        "pagehide",
        () => {
            disposed = true;
            cancelAnimationFrame(raf);
            renderer.dispose();
        },
        { once: true },
    );
}
