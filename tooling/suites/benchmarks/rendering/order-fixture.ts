import { Camera, Frame } from "../../../../src/index.js";
import { createGpuContext } from "../../../../src/gpu-context.js";
import { createQuadRenderer } from "../../../../src/quad-renderer.js";
import { Game } from "../../../../src/index.js";
import { arena, W, H, type Progress, type ProgressCommand } from "../../../../demo/game.js";
import { preparationStages } from "./preparation-diagnostics.js";
import { auditOrder } from "./order-audit.js";

export async function startOrderInvestigation(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const count = Number(params.get("count") ?? 64000);
    const shuffled = params.get("order") === "shuffled";
    const detailed = params.get("detail") !== "0";
    const chaos = params.get("workload") === "chaos";
    const audit = params.get("audit") === "1";
    const keys = params.get("keys") ?? "layers";
    if (!["layers", "mixed-depth", "late-depth", "wide-layers", "scenes"].includes(keys))
        throw Error("Invalid key fixture");
    const width = chaos ? W : 1440,
        height = chaos ? H : 900;
    const audits: (ReturnType<typeof auditOrder> & { tick: number; canonicalIdentity: boolean })[] =
        [];
    if (!Number.isSafeInteger(count) || count < 1 || count > 128000 || count % 4 !== 0)
        throw Error("Invalid count");
    const samples: number[][] = [];
    const state = {
        ready: false,
        hidden: false,
        error: "",
        done: false,
        sampleBegin: 0,
        sampleEnd: 0,
        visibilityEvents: [{ time: performance.now(), state: document.visibilityState }],
        audits,
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
            "prepare",
            "validation",
            "growth",
            "gather",
            "update",
            "tick",
        ],
        samples,
        metadata: {
            count,
            shuffled,
            detailed,
            width,
            height,
            stages: preparationStages.instrumented,
            audit,
            keys,
            workload: chaos
                ? "unchanged Chaos replay: seed bench, key chaos, 900 ticks, alpha 0.5, first 101 warmup"
                : "ordering",
            timing: "prepareOther includes texture validation and reorder copy; CPU only",
        },
    };
    Object.assign(window, { __investigation: state });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
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
    let atlas: GPUTexture | undefined;
    if (chaos) {
        const response = await fetch(
            new URL("../../../../demo/assets/starfall.png", import.meta.url),
        );
        if (!response.ok) throw Error("Chaos atlas unavailable");
        const bitmap = await createImageBitmap(await response.blob(), {
            premultiplyAlpha: "none",
            colorSpaceConversion: "none",
        });
        try {
            atlas = context.device.createTexture({
                size: [bitmap.width, bitmap.height],
                format: "rgba8unorm",
                usage:
                    GPUTextureUsage.TEXTURE_BINDING |
                    GPUTextureUsage.COPY_DST |
                    GPUTextureUsage.RENDER_ATTACHMENT,
            });
            context.device.queue.copyExternalImageToTexture(
                { source: bitmap },
                { texture: atlas },
                [bitmap.width, bitmap.height],
            );
            await renderer.texture("ships", atlas.createView());
        } finally {
            bitmap.close();
        }
    }
    const frame = new Frame(),
        camera = new Camera();
    const game = chaos
        ? new Game<Progress, ProgressCommand>({
              seed: "bench",
              state: { best: 0, runs: 0, victories: 0, lastScore: 0 },
              transition: (s) => s,
          })
        : undefined;
    if (game) await game.start(await game.prepare(arena({ stress: true }), { key: "chaos" }));
    let tickIndex = 0;
    camera.pixelSnap = false;
    let sortMs = 0,
        previous = 0,
        stopped = false,
        raf = 0;
    const sort = frame.sort;
    if (detailed && !preparationStages.instrumented)
        frame.sort = () => {
            const start = performance.now();
            sort.call(frame);
            sortMs = performance.now() - start;
        };
    const tick = () => {
        if (stopped || state.error) return;
        const start = performance.now();
        tickIndex++;
        if (chaos && tickIndex === 102) state.sampleBegin = start;
        if (document.hidden) state.hidden = true;
        game?.tick();
        const updated = performance.now();
        frame.reset();
        if (game) game.render(frame, 0.5);
        else {
            frame.scene(camera, 1);
            for (let i = 0; i < count; i++) {
                if (keys === "scenes" && i === count / 2) frame.scene(camera, 1);
                // Both orders submit identical per-layer geometry and stable within-layer order.
                const layer = shuffled ? i % 4 : Math.floor((i * 4) / count);
                const row = shuffled ? Math.floor(i / 4) : i % (count / 4);
                if (keys === "mixed-depth" || keys === "late-depth")
                    frame.sprite({
                        x: (row % 360) * 4 + 2,
                        y: (Math.floor(row / 360) % 225) * 4 + 2,
                        width: 3,
                        height: 3,
                        color: 0x60a0c0 + layer * 0x10101,
                        alpha: 0.5,
                        layer,
                        screen: true,
                        depth: keys === "mixed-depth" ? (i % 3) * 0.25 : i === count - 1 ? 0.25 : 0,
                    });
                else
                    frame.rect(
                        (row % 360) * 4 + 2,
                        (Math.floor(row / 360) % 225) * 4 + 2,
                        3,
                        3,
                        0x60a0c0 + layer * 0x10101,
                        0.5,
                        keys === "wide-layers" ? layer * 32 : layer,
                        true,
                    );
            }
        }
        const packed = performance.now();
        const observation = audit ? auditOrder(frame) : undefined;
        const preparing = performance.now();
        renderer.prepare(frame);
        const prepared = performance.now();
        const encoder = context.device.createCommandEncoder();
        renderer.encode(encoder, context.acquire(), frame, width, height, 0x090e20);
        context.submit(encoder);
        const end = performance.now();
        samples.push([
            start,
            previous ? start - previous : 0,
            packed - updated,
            preparationStages.instrumented ? preparationStages.sort : detailed ? sortMs : -1,
            detailed && !preparationStages.instrumented ? prepared - preparing - sortMs : -1,
            end - prepared,
            end - start,
            frame.count,
            renderer.stats.uploadedBytes,
            renderer.stats.bufferGrowths,
            prepared - preparing,
            preparationStages.instrumented ? preparationStages.validation : -1,
            preparationStages.instrumented ? preparationStages.growth : -1,
            preparationStages.instrumented ? preparationStages.gather : -1,
            updated - start,
            tickIndex,
        ]);
        if (observation)
            audits.push({
                ...observation,
                tick: tickIndex,
                canonicalIdentity: frame.order.every((index, position) => index === position),
            });
        previous = start;
        state.ready = true;
        if (samples.length >= 30000) fail("Sample limit");
        if (chaos && tickIndex === 900) {
            state.done = true;
            state.sampleEnd = performance.now();
            return;
        }
        raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", () => {
        state.visibilityEvents.push({ time: performance.now(), state: document.visibilityState });
        if (document.hidden) state.hidden = true;
    });
    window.addEventListener(
        "pagehide",
        () => {
            stopped = true;
            cancelAnimationFrame(raf);
            renderer.dispose();
            white.destroy();
            atlas?.destroy();
            context.dispose();
            void game?.dispose();
        },
        { once: true },
    );
    raf = requestAnimationFrame(tick);
}
