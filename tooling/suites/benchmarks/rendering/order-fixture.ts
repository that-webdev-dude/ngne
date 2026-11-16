import { Camera, Frame } from "../../../../src/index.js";
import { createGpuContext } from "../../../../src/gpu-context.js";
import { createQuadRenderer } from "../../../../src/quad-renderer.js";
import { preparationStages } from "./preparation-diagnostics.js";
import { auditOrder, sortFastPathGuard } from "./order-audit.js";
import {
    ATLAS,
    TILESETS,
    emitTilemap,
    fittedZoom,
    tilemapPlan,
    type TilemapPlan,
} from "./tilemap-fixture.js";

/** One deterministic 256×256 atlas per tileset; setup only, outside every timed region. */
function createAtlas(device: GPUDevice, set: number): GPUTexture {
    const texture = device.createTexture({
        size: [ATLAS, ATLAS],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const pixels = new Uint8Array(ATLAS * ATLAS * 4);
    for (let i = 0, o = 0; i < ATLAS * ATLAS; i++, o += 4) {
        pixels[o] = (i * 7 + set * 90) & 255;
        pixels[o + 1] = (i >> 8) & 255;
        pixels[o + 2] = set ? 200 : 60;
        pixels[o + 3] = 255;
    }
    device.queue.writeTexture({ texture }, pixels, { bytesPerRow: ATLAS * 4 }, [ATLAS, ATLAS]);
    return texture;
}

export async function startOrderInvestigation(): Promise<void> {
    const params = new URLSearchParams(location.search);
    // The tilemap defaults to its live-tier size; an explicit count needs explicit columns.
    const tilemapDefault = params.get("keys") === "tilemap" && !params.has("count");
    const count = Number(params.get("count") ?? (tilemapDefault ? 66560 : 64000));
    const shuffled = params.get("order") === "shuffled";
    const detailed = params.get("detail") !== "0";
    if (params.get("workload") !== "ordering")
        throw new Error(
            "Only the ordering workload is supported; Starfall Chaos replay is retired",
        );
    const audit = params.get("audit") === "1";
    const keys = params.get("keys") ?? "layers";
    if (
        ![
            "layers",
            "mixed-depth",
            "late-depth",
            "late-depth-down",
            "wide-layers",
            "scenes",
            "tilemap",
        ].includes(keys)
    )
        throw new Error("Invalid key fixture");
    const width = 1440,
        height = 900;
    const audits: (ReturnType<typeof auditOrder> &
        ReturnType<typeof sortFastPathGuard> & {
            tick: number;
            canonicalIdentity: boolean;
            comparatorSort: boolean;
            guardAgrees: boolean;
        })[] = [];
    const tilemap = keys === "tilemap";
    if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        count > (tilemap ? 1048576 : 128000) ||
        count % 4 !== 0
    )
        throw new Error("Invalid count");
    let plan: TilemapPlan | undefined;
    if (tilemap) {
        const defaultColumns = tilemapDefault ? 130 : Number.NaN;
        plan = tilemapPlan(count, Number(params.get("columns") ?? defaultColumns));
    }
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
            "upload",
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
            tilemap: plan && {
                layers: plan.layers,
                columns: plan.columns,
                rows: plan.rows,
                tilesets: TILESETS.length,
            },
            workload: "ordering",
            timing: "prepareOther includes texture validation and reorder copy; upload is the instance writeBuffer call; CPU only",
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
    // Atlases exist only for the tilemap workload so other ordering cases keep their setup.
    const atlases = (plan ? TILESETS : []).map((id, set) => ({
        id,
        texture: createAtlas(context.device, set),
    }));
    for (const atlas of atlases) await renderer.texture(atlas.id, atlas.texture.createView());
    const frame = new Frame(),
        camera = new Camera();
    let tickIndex = 0;
    camera.pixelSnap = false;
    if (plan) camera.cut(0, 0, fittedZoom(plan, width, height));
    let comparatorSorts = 0;
    if (audit)
        // Observes which path Frame.sort() takes without changing it: only the comparator
        // fallback calls order.sort().
        Object.defineProperty(frame.order, "sort", {
            configurable: true,
            value(this: number[], compare: (a: number, b: number) => number) {
                comparatorSorts++;
                return Array.prototype.sort.call(this, compare);
            },
        });
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
        if (document.hidden) state.hidden = true;
        const updated = performance.now();
        frame.reset();
        if (plan) {
            frame.scene(camera, 1);
            emitTilemap(frame, plan);
        } else {
            frame.scene(camera, 1);
            for (let i = 0; i < count; i++) {
                if (keys === "scenes" && i === count / 2) frame.scene(camera, 1);
                // Both orders submit identical per-layer geometry and stable within-layer order.
                const layer = shuffled ? i % 4 : Math.floor((i * 4) / count);
                const row = shuffled ? Math.floor(i / 4) : i % (count / 4);
                if (keys === "mixed-depth" || keys === "late-depth" || keys === "late-depth-down")
                    frame.sprite({
                        x: (row % 360) * 4 + 2,
                        y: (Math.floor(row / 360) % 225) * 4 + 2,
                        width: 3,
                        height: 3,
                        color: 0x60a0c0 + layer * 0x10101,
                        alpha: 0.5,
                        layer,
                        screen: true,
                        depth:
                            keys === "mixed-depth"
                                ? (i % 3) * 0.25
                                : i === count - 1
                                  ? keys === "late-depth-down"
                                      ? -0.25
                                      : 0.25
                                  : 0,
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
        const guard = audit ? sortFastPathGuard(frame) : undefined;
        comparatorSorts = 0;
        const preparing = performance.now();
        renderer.prepare(frame);
        const prepared = performance.now();
        const encoder = context.device.createCommandEncoder();
        renderer.encode(encoder, context.acquire(), frame, width, height, 0x090e20);
        context.submit(encoder);
        const end = performance.now();
        // Untimed: the frame's measurements are already taken.
        let sortColumn = -1;
        if (preparationStages.instrumented) sortColumn = preparationStages.sort;
        else if (detailed) sortColumn = sortMs;
        samples.push([
            start,
            previous ? start - previous : 0,
            packed - updated,
            sortColumn,
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
            preparationStages.instrumented ? preparationStages.upload : -1,
        ]);
        if (observation && guard)
            audits.push({
                ...observation,
                ...guard,
                comparatorSort: comparatorSorts > 0,
                // The observed comparator call is ground truth; disagreement means the
                // guard mirror in order-audit.ts drifted from Frame.sort().
                guardAgrees: guard.eligible === (comparatorSorts === 0),
                tick: tickIndex,
                canonicalIdentity: frame.order.every((index, position) => index === position),
            });
        previous = start;
        state.ready = true;
        if (samples.length >= 30000) fail("Sample limit");
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
            for (const atlas of atlases) atlas.texture.destroy();
            context.dispose();
        },
        { once: true },
    );
    raf = requestAnimationFrame(tick);
}
