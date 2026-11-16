import type { TextureSampling } from "../src/assets.js";
import { Frame } from "../src/renderer.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";

const SIZE = 64;
const RAMP = [40, 240];
const TILES = [
    [200, 40, 40],
    [40, 200, 40],
    [40, 40, 200],
    [200, 200, 40],
];
/**
 * Ramp quads span 7 pixels for 2 texels: a non-integer 3.5× scale. The small UV origin
 * keeps every pixel centre away from the nearest-filter texel boundary.
 */
const RAMP_LEFT = 4,
    RAMP_WIDTH = 7,
    RAMP_U = 0.02;
const RAMP_ROWS = { linear: 2, nearest: 8, wrap: 14 };
/** Tile quads span 8×8 pixels with UVs 0–2: each texel covers 2×2 pixels per repetition. */
const TILE_TOP = 2,
    TILE_SIZE = 8;
const TILE_LEFTS = { repeat: 24, clamp: 40 };

/** Texel-space coordinate sampled by the centre of ramp pixel `px`. */
const rampTexel = (px: number) => (RAMP_U + (px - RAMP_LEFT + 0.5) / RAMP_WIDTH) * 2 - 0.5;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function expectedRamp(mode: keyof typeof RAMP_ROWS, px: number): number {
    const t = rampTexel(px);
    if (mode === "nearest") return RAMP[Math.min(1, Math.floor(t + 0.5))];
    if (mode === "linear") return lerp(RAMP[0], RAMP[1], Math.min(1, Math.max(0, t)));
    const base = Math.floor(t);
    return lerp(RAMP[((base % 2) + 2) % 2], RAMP[(((base + 1) % 2) + 2) % 2], t - base);
}

function expectedTile(mode: keyof typeof TILE_LEFTS, px: number, py: number): number[] {
    const left = TILE_LEFTS[mode];
    if (px < left || px >= left + TILE_SIZE || py < TILE_TOP || py >= TILE_TOP + TILE_SIZE)
        return [0, 0, 0, 255];
    let i = Math.floor((px - left) / 2),
        j = Math.floor((py - TILE_TOP) / 2);
    if (mode === "repeat") [i, j] = [i % 2, j % 2];
    else [i, j] = [Math.min(i, 1), Math.min(j, 1)];
    return [...TILES[j * 2 + i], 255];
}

function canvasOf(width: number, height: number, texels: number[][]): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    const pixels = new Uint8ClampedArray(width * height * 4);
    texels.forEach((texel, index) => pixels.set([...texel, 255], index * 4));
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
    return canvas;
}

/**
 * Linear textures filter at a non-integer scale, repeat textures tile whole-texture UVs
 * beyond 0–1, defaults stay nearest/clamp, and every route keeps its sampling across a
 * controlled device loss with byte-identical output.
 */
export async function checkBrowserTextureSampling(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const real = navigator.gpu,
        devices: GPUDevice[] = [],
        diagnostics: unknown[] = [];
    const gpu = {
        wgslLanguageFeatures: real.wgslLanguageFeatures,
        getPreferredCanvasFormat: () => real.getPreferredCanvasFormat(),
        async requestAdapter(options?: GPURequestAdapterOptions) {
            const adapter = await real.requestAdapter(options);
            if (!adapter) return null;
            return new Proxy(adapter, {
                get(target, key) {
                    if (key === "requestDevice")
                        return async (descriptor?: GPUDeviceDescriptor) => {
                            const device = await target.requestDevice(descriptor);
                            devices.push(device);
                            return device;
                        };
                    const value = Reflect.get(target, key, target);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            });
        },
    } as GPU;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    canvas.setAttribute("aria-label", "WebGPU texture sampling canvas");
    document.body.append(canvas);
    const runtime = await WebGpuRuntime.create(
        canvas,
        SIZE,
        SIZE,
        (error) => diagnostics.push(error),
        { gpu },
    );
    const rampTexels = RAMP.map((value) => [value, value, value]);
    const ramp = canvasOf(2, 1, rampTexels),
        tiles = canvasOf(2, 2, TILES);
    const bitmap = await createImageBitmap(ramp, {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
    });
    const read = document.createElement("canvas");
    read.width = read.height = SIZE;
    const reader = read.getContext("2d", { willReadFrequently: true });
    if (!reader) throw new Error("Canvas readback unavailable");
    try {
        const wrap: TextureSampling = { filter: "linear", address: "repeat" };
        await runtime.acquire(
            { id: "ramp-wrap", kind: "image", load: async () => bitmap, sampling: wrap },
            { id: "ramp-wrap", value: bitmap, release() {} },
            new AbortController().signal,
        );
        await runtime.createTexture("ramp-linear", 2, 1, undefined, { filter: "linear" });
        await runtime.updateTexture(
            "ramp-linear",
            { width: 2, height: 1, data: new Uint8Array(rampTexels.flatMap((t) => [...t, 255])) },
            { sourceX: 0, sourceY: 0, width: 2, height: 1, destinationX: 0, destinationY: 0 },
        );
        await runtime.texture("ramp-nearest", ramp);
        await runtime.texture("tiles-repeat", tiles, undefined, { address: "repeat" });
        await runtime.texture("tiles-clamp", tiles);
        const frame = new Frame();
        for (const [mode, top] of Object.entries(RAMP_ROWS))
            frame.sprite({
                x: RAMP_LEFT + RAMP_WIDTH / 2,
                y: top + 1,
                width: RAMP_WIDTH,
                height: 2,
                texture: "ramp-" + mode,
                u: RAMP_U,
            });
        for (const [mode, left] of Object.entries(TILE_LEFTS))
            frame.sprite({
                x: left + TILE_SIZE / 2,
                y: TILE_TOP + TILE_SIZE / 2,
                width: TILE_SIZE,
                height: TILE_SIZE,
                texture: "tiles-" + mode,
                uw: 2,
                vh: 2,
            });
        const render = () => {
            runtime.render(frame, 0);
            reader.drawImage(canvas, 0, 0);
            return reader.getImageData(0, 0, SIZE, SIZE).data;
        };
        const pixel = (bytes: Uint8ClampedArray, x: number, y: number) =>
            Array.from(bytes.subarray((y * SIZE + x) * 4, (y * SIZE + x + 1) * 4));
        const before = render();
        check(
            runtime.drawCalls === 5 && runtime.sprites === 5,
            `WebGPU texture sampling draws five sampled quads in five texture runs (${runtime.drawCalls})`,
        );
        const ramps = Object.fromEntries(
            Object.entries(RAMP_ROWS).map(([mode, top]) => {
                const row = [];
                for (let px = RAMP_LEFT; px < RAMP_LEFT + RAMP_WIDTH; px++) {
                    const [r, g, b, a] = pixel(before, px, top);
                    row.push(r === g && g === b && a === 255 ? r : -1);
                }
                return [mode, row];
            }),
        ) as Record<keyof typeof RAMP_ROWS, number[]>;
        const within = (mode: keyof typeof RAMP_ROWS, tolerance: number) =>
            ramps[mode].every(
                (value, index) =>
                    Math.abs(value - expectedRamp(mode, RAMP_LEFT + index)) <= tolerance,
            );
        check(
            within("nearest", 0) && ramps.nearest.every((value) => RAMP.includes(value)),
            `WebGPU default sampling stays nearest at a 3.5× scale: ${ramps.nearest.join()}`,
        );
        const intermediate = ramps.linear.filter((value) => value > RAMP[0] && value < RAMP[1]);
        check(
            within("linear", 3) &&
                intermediate.length >= 3 &&
                ramps.linear.every(
                    (value, index) => index === 0 || value >= ramps.linear[index - 1],
                ),
            `WebGPU linear texture filters at a 3.5× scale within ±3 of bilinear: ${ramps.linear.join()}`,
        );
        check(
            within("wrap", 3) && ramps.wrap[0] > RAMP[0] + 40 && ramps.wrap[6] < RAMP[1] - 40,
            `WebGPU linear repeat texture blends across the wrapped edge: ${ramps.wrap.join()}`,
        );
        for (const mode of ["repeat", "clamp"] as const) {
            let mismatch = "";
            const left = TILE_LEFTS[mode];
            for (let py = TILE_TOP - 1; py <= TILE_TOP + TILE_SIZE && !mismatch; py++)
                for (let px = left - 1; px <= left + TILE_SIZE && !mismatch; px++) {
                    const actual = pixel(before, px, py).join(),
                        expected = expectedTile(mode, px, py).join();
                    if (actual !== expected) mismatch = ` (${px},${py}: ${actual} != ${expected})`;
                }
            check(
                !mismatch,
                mode === "repeat"
                    ? `WebGPU repeat texture tiles UVs 0–2 into exact 2×2 texel repetitions${mismatch}`
                    : `WebGPU default clamp texture holds edge texels for UVs beyond 1${mismatch}`,
            );
        }
        devices[0].destroy();
        await devices[0].lost;
        await runtime.ready();
        const after = render();
        check(
            devices.length === 2 &&
                runtime.status === "ready" &&
                after.every((value, index) => value === before[index]),
            "WebGPU texture sampling survives controlled device loss with byte-identical pixels on every route",
        );
        await devices[1].queue.onSubmittedWorkDone();
        check(
            diagnostics.length === 0,
            "WebGPU texture sampling has zero diagnostics: " + diagnostics.map(String).join("; "),
        );
    } finally {
        runtime.dispose();
        bitmap.close();
        canvas.remove();
    }
}
