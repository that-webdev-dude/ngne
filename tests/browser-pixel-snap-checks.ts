import { QUAD_STRIDE } from "../src/quad-layout.js";
import { createQuadRenderer } from "../src/quad-renderer.js";
import { Frame } from "../src/renderer.js";
import { uploadImage } from "../src/texture-assets.js";
import { Camera } from "../src/primitives.js";

const WIDTH = 5,
    HEIGHT = 3,
    SIZE = 64,
    ROW_BYTES = 256;
const CLEAR = [0, 0, 0, 255];
const texel = (i: number, j: number) => [30 + 50 * i, 40 + 80 * j, 250 - 40 * i, 255];

interface SnapCase {
    label: string;
    flip: number;
    left: number;
    top: number;
}

/** Six odd-sized quads, one scene each, in disjoint regions of one 64×64 frame. */
function packCases(frame: Frame): SnapCase[] {
    const inputs = [
        { label: "world, negative camera", camera: [-10.375, -2.25], x: 10.875, y: 10.6 },
        { label: "world, negative sprite", camera: [-31.6, -40.2], x: -9.45, y: -19.3 },
        { label: "screen-space", camera: [7.3, 5.9], x: 40.6, y: 47.75, screen: true },
    ];
    const cases: SnapCase[] = [];
    for (const { label, camera: position, x, y, screen } of inputs)
        for (const flip of [1, -1]) {
            const camera = new Camera();
            camera.cut(position[0], position[1]);
            frame.scene(camera, 1);
            // Flipped copies sit 16 pixels to the right of their unflipped pair.
            const sprite = { x: flip > 0 ? x : x + 16, y, texture: "odd", screen };
            frame.sprite({ ...sprite, width: flip * WIDTH, height: HEIGHT });
            const o = (frame.count - 1) * QUAD_STRIDE;
            const [tx, ty, ix, , , jy] = frame.data.subarray(o, o + 6);
            const suffix = flip < 0 ? " flipped" : "";
            const left = Math.min(tx, tx + ix),
                top = Math.min(ty, ty + jy);
            cases.push({ label: label + suffix, flip, left, top });
        }
    return cases;
}

function expectedPixel(snap: SnapCase, px: number, py: number): number[] {
    const i = px - snap.left,
        j = py - snap.top;
    if (i < 0 || i >= WIDTH || j < 0 || j >= HEIGHT) return CLEAR;
    const column = snap.flip > 0 ? i : WIDTH - 1 - i;
    return texel(column, j);
}

/** Scans a one-pixel border too: no texel may bleed outside the snapped rectangle. */
function findMismatch(read: (x: number, y: number) => number[], snap: SnapCase): string {
    for (let py = snap.top - 1; py <= snap.top + HEIGHT; py++)
        for (let px = snap.left - 1; px <= snap.left + WIDTH; px++) {
            const actual = read(px, py).join(),
                expected = expectedPixel(snap, px, py).join();
            if (actual !== expected) return `${px},${py}: ${actual} != ${expected}`;
        }
    return "";
}

async function sourceBitmap(): Promise<ImageBitmap> {
    const source = document.createElement("canvas");
    source.width = WIDTH;
    source.height = HEIGHT;
    const context = source.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let j = 0; j < HEIGHT; j++)
        for (let i = 0; i < WIDTH; i++) pixels.set(texel(i, j), (j * WIDTH + i) * 4);
    context.putImageData(new ImageData(pixels, WIDTH, HEIGHT), 0, 0);
    return createImageBitmap(source, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

/** Odd-sized snapped quads at fractional positions map each texel to exactly one pixel. */
export async function checkBrowserPixelSnap(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error("Required WebGPU pixel-snap checks unavailable");
    const device = await adapter.requestDevice();
    const errors: string[] = [];
    device.addEventListener("uncapturederror", (event) => errors.push(event.error.message));
    const format = navigator.gpu.getPreferredCanvasFormat();
    const quad = await createQuadRenderer(device, format);
    const target = device.createTexture({
        size: [SIZE, SIZE],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
        size: ROW_BYTES * SIZE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const bitmap = await sourceBitmap();
    const texture = await uploadImage(device, bitmap);
    try {
        await quad.texture("odd", texture.createView());
        const frame = new Frame();
        const cases = packCases(frame);
        quad.prepare(frame);
        const encoder = device.createCommandEncoder();
        quad.encode(encoder, target.createView(), frame, SIZE, SIZE, 0);
        encoder.copyTextureToBuffer(
            { texture: target },
            { buffer: readback, bytesPerRow: ROW_BYTES },
            [SIZE, SIZE],
        );
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(readback.getMappedRange().slice(0));
        readback.unmap();
        const swizzle = format === "bgra8unorm" ? [2, 1, 0, 3] : [0, 1, 2, 3];
        const read = (x: number, y: number) =>
            swizzle.map((channel) => bytes[y * ROW_BYTES + x * 4 + channel]);
        for (const snap of cases) {
            const mismatch = findMismatch(read, snap);
            const detail = mismatch ? ` (${mismatch})` : "";
            check(
                Number.isInteger(snap.left) && Number.isInteger(snap.top) && !mismatch,
                `WebGPU pixel snap ${snap.label}: ${WIDTH}×${HEIGHT} texels map 1:1 at ${snap.left},${snap.top}${detail}`,
            );
        }
        await device.queue.onSubmittedWorkDone();
        check(
            errors.length === 0,
            "WebGPU pixel snap has zero validation errors: " + errors.join("; "),
        );
    } finally {
        quad.dispose();
        texture.destroy();
        bitmap.close();
        readback.destroy();
        target.destroy();
        device.destroy();
    }
}
