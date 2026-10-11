import { Camera, Frame } from "../../../../src/index.js";
import { createGpuContext } from "../../../../src/gpu-context.js";
import { createQuadRenderer } from "../../../../src/quad-renderer.js";

export async function startOrderInvestigation(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const count = Number(params.get("count") ?? 64000);
    const shuffled = params.get("order") === "shuffled";
    const detailed = params.get("detail") !== "0";
    if (!Number.isSafeInteger(count) || count < 1 || count > 128000 || count % 4 !== 0)
        throw Error("Invalid count");
    const samples: number[][] = [];
    const state = {
        ready: false,
        hidden: false,
        error: "",
        columns: [
            "time",
            "cadence",
            "pack",
            "sort",
            "prepareOther",
            "encodeSubmit",
            "cpu",
            "quads",
            "uploadBytes",
            "growths",
        ],
        samples,
        metadata: {
            count,
            shuffled,
            detailed,
            width: 1440,
            height: 900,
            timing: "prepareOther includes texture validation and reorder copy; CPU only",
        },
    };
    Object.assign(window, { __investigation: state });
    const canvas = document.createElement("canvas");
    canvas.width = 1440;
    canvas.height = 900;
    canvas.style.cssText = "width:100%;max-width:1440px;display:block";
    document.body.prepend(canvas);
    const fail = (error: unknown) => {
        state.error = String(error);
    };
    const context = await createGpuContext(canvas, new AbortController().signal, fail, fail);
    const renderer = await createQuadRenderer(context.device, context.format);
    const white = context.device.createTexture({
        size: [1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    context.device.queue.writeTexture(
        { texture: white },
        new Uint8Array([255, 255, 255, 255]),
        {},
        [1, 1],
    );
    await renderer.texture("", white.createView());
    const frame = new Frame(),
        camera = new Camera();
    camera.pixelSnap = false;
    let sortMs = 0,
        previous = 0,
        stopped = false,
        raf = 0;
    const sort = frame.sort;
    if (detailed)
        frame.sort = () => {
            const start = performance.now();
            sort.call(frame);
            sortMs = performance.now() - start;
        };
    const tick = () => {
        if (stopped || state.error) return;
        const start = performance.now();
        if (document.hidden) state.hidden = true;
        frame.reset();
        frame.scene(camera, 1);
        for (let i = 0; i < count; i++) {
            // Both orders submit identical per-layer geometry and stable within-layer order.
            const layer = shuffled ? i % 4 : Math.floor((i * 4) / count);
            const row = shuffled ? Math.floor(i / 4) : i % (count / 4);
            frame.rect(
                (row % 360) * 4 + 2,
                (Math.floor(row / 360) % 225) * 4 + 2,
                3,
                3,
                0x60a0c0 + layer * 0x10101,
                0.5,
                layer,
                true,
            );
        }
        const packed = performance.now();
        renderer.prepare(frame);
        const prepared = performance.now();
        const encoder = context.device.createCommandEncoder();
        renderer.encode(encoder, context.acquire(), frame, 1440, 900, 0x090e20);
        context.submit(encoder);
        const end = performance.now();
        samples.push([
            start,
            previous ? start - previous : 0,
            packed - start,
            detailed ? sortMs : -1,
            detailed ? prepared - packed - sortMs : -1,
            end - prepared,
            end - start,
            count,
            renderer.stats.uploadedBytes,
            renderer.stats.bufferGrowths,
        ]);
        previous = start;
        state.ready = true;
        if (samples.length >= 30000) fail("Sample limit");
        raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) state.hidden = true;
    });
    window.addEventListener(
        "pagehide",
        () => {
            stopped = true;
            cancelAnimationFrame(raf);
            renderer.dispose();
            white.destroy();
            context.dispose();
        },
        { once: true },
    );
    raf = requestAnimationFrame(tick);
}
