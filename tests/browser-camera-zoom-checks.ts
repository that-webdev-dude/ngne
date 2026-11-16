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

interface ZoomCase {
    label: string;
    scale: number;
    left: number;
    top: number;
}

/** One quad per scene in disjoint regions of a 64×64 frame. */
function packCases(frame: Frame): ZoomCase[] {
    const inputs = [
        { label: "world zoom 3, fractional camera", camera: [-1.375, -2.25], x: 3.6, y: 3.4 },
        { label: "world zoom 2, negative sprite", camera: [-31.6, -40.2], x: -9.45, y: -19.3 },
        { label: "screen-space", camera: [7.3, 5.9], x: 40.6, y: 56.75, screen: true },
    ];
    const zooms = [3, 2, 4];
    const cases: ZoomCase[] = [];
    inputs.forEach(({ label, camera: position, x, y, screen }, index) => {
        const camera = new Camera();
        camera.cut(position[0], position[1], zooms[index]);
        frame.scene(camera, 1);
        frame.sprite({ x, y, width: WIDTH, height: HEIGHT, texture: "odd", screen });
        const o = (frame.count - 1) * QUAD_STRIDE;
        const [tx, ty, ix] = frame.data.subarray(o, o + 3);
        // Expected placement from the requested zoom about the viewport's top-left.
        const scale = screen ? 1 : zooms[index];
        const left = Math.round((screen ? x : (x - position[0]) * scale) - (WIDTH * scale) / 2),
            top = Math.round((screen ? y : (y - position[1]) * scale) - (HEIGHT * scale) / 2);
        if (tx !== left || ty !== top || ix !== WIDTH * scale)
            throw new Error(`Camera zoom ${label} packed ${tx},${ty},${ix}`);
        cases.push({ label, scale, left, top });
    });
    return cases;
}

/**
 * Fractional snapped world quads under a moving, shaken zoom-1 camera, or the same quads
 * pre-subtracted into screen space: the path that never reads the camera.
 */
function packUnitZoom(frame: Frame, screen: boolean): void {
    const camera = new Camera();
    camera.cut(-3.3, 2.6, 1);
    camera.beginTick();
    camera.x = -4.1;
    camera.y = 3.35;
    camera.shakeX = 0.4;
    const view = camera.view(0.35);
    frame.scene(camera, 0.35);
    for (let i = 0; i < 12; i++) {
        const x = 2.3 + 5.1 * i,
            y = 6.7 + 4.45 * i,
            width = i % 2 ? WIDTH : -WIDTH;
        frame.sprite({
            x: screen ? x - view.x : x,
            y: screen ? y - view.y : y,
            width,
            height: HEIGHT,
            rotation: i % 3 ? 0 : Math.PI / 2,
            texture: "odd",
            screen,
        });
    }
}

function expectedPixel(zoom: ZoomCase, px: number, py: number): number[] {
    const i = Math.floor((px - zoom.left) / zoom.scale),
        j = Math.floor((py - zoom.top) / zoom.scale);
    if (i < 0 || i >= WIDTH || j < 0 || j >= HEIGHT) return CLEAR;
    return texel(i, j);
}

/** Scans a one-pixel border too: no texel may bleed outside the snapped rectangle. */
function findMismatch(read: (x: number, y: number) => number[], zoom: ZoomCase): string {
    for (let py = zoom.top - 1; py <= zoom.top + HEIGHT * zoom.scale; py++)
        for (let px = zoom.left - 1; px <= zoom.left + WIDTH * zoom.scale; px++) {
            const actual = read(px, py).join(),
                expected = expectedPixel(zoom, px, py).join();
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

/**
 * Snapped world quads at integer zoom map each texel to a zoom×zoom block of whole pixels,
 * screen-space quads stay 1:1, and zoom 1 renders the same bytes as an unzoomed camera.
 */
export async function checkBrowserCameraZoom(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error("Required WebGPU camera zoom checks unavailable");
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
    const render = async (frame: Frame): Promise<Uint8Array> => {
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
        return bytes;
    };
    try {
        await quad.texture("odd", texture.createView());
        const frame = new Frame();
        const cases = packCases(frame);
        const bytes = await render(frame);
        const swizzle = format === "bgra8unorm" ? [2, 1, 0, 3] : [0, 1, 2, 3];
        const read = (x: number, y: number) =>
            swizzle.map((channel) => bytes[y * ROW_BYTES + x * 4 + channel]);
        for (const zoom of cases) {
            const mismatch = findMismatch(read, zoom);
            const detail = mismatch ? ` (${mismatch})` : "";
            check(
                Number.isInteger(zoom.left) && Number.isInteger(zoom.top) && !mismatch,
                `WebGPU camera zoom ${zoom.label}: ${WIDTH}×${HEIGHT} texels map to ${zoom.scale}×${zoom.scale} pixel blocks at ${zoom.left},${zoom.top}${detail}`,
            );
        }
        check(
            cases[2].scale === 1,
            "WebGPU camera zoom leaves screen-space quads at one pixel per texel",
        );
        const [zoomed, reference] = [new Frame(), new Frame()];
        packUnitZoom(zoomed, false);
        packUnitZoom(reference, true);
        const first = await render(zoomed),
            second = await render(reference);
        check(
            first.every((value, index) => value === second[index]),
            "WebGPU camera zoom 1 renders byte-identically to unzoomed camera subtraction",
        );
        await device.queue.onSubmittedWorkDone();
        check(
            errors.length === 0,
            "WebGPU camera zoom has zero validation errors: " + errors.join("; "),
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
