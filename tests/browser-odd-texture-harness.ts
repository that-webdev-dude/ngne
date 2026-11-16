import { createQuadRenderer } from "../src/quad-renderer.js";
import type { Frame } from "../src/renderer.js";
import { uploadImage } from "../src/texture-assets.js";

/** A 5×3 texture with distinct texels, registered as `"odd"`, drawn into a 64×64 target. */
export const ODD_WIDTH = 5,
    ODD_HEIGHT = 3;
export const CLEAR = [0, 0, 0, 255];
export const oddTexel = (i: number, j: number) => [30 + 50 * i, 40 + 80 * j, 250 - 40 * i, 255];
const SIZE = 64,
    ROW_BYTES = 256;

export interface Readback {
    /** Raw target bytes in the preferred canvas format. */
    readonly bytes: Uint8Array;
    /** RGBA at one target pixel. */
    read(x: number, y: number): number[];
}

export interface OddTextureHarness {
    render(frame: Frame): Promise<Readback>;
    /** Waits for submitted work and returns uncaptured validation messages. */
    errors(): Promise<string[]>;
    dispose(): void;
}

/**
 * Scans a rectangle plus a one-pixel border, so no texel may bleed outside it.
 * Returns the first mismatch as `x,y: actual != expected`, or an empty string.
 */
export function findMismatch(
    read: (x: number, y: number) => number[],
    rect: { left: number; top: number; width: number; height: number },
    expected: (x: number, y: number) => number[],
): string {
    for (let py = rect.top - 1; py <= rect.top + rect.height; py++)
        for (let px = rect.left - 1; px <= rect.left + rect.width; px++) {
            const actual = read(px, py).join(),
                wanted = expected(px, py).join();
            if (actual !== wanted) return `${px},${py}: ${actual} != ${wanted}`;
        }
    return "";
}

async function sourceBitmap(): Promise<ImageBitmap> {
    const source = document.createElement("canvas");
    source.width = ODD_WIDTH;
    source.height = ODD_HEIGHT;
    const context = source.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    const pixels = new Uint8ClampedArray(ODD_WIDTH * ODD_HEIGHT * 4);
    for (let j = 0; j < ODD_HEIGHT; j++)
        for (let i = 0; i < ODD_WIDTH; i++) pixels.set(oddTexel(i, j), (j * ODD_WIDTH + i) * 4);
    context.putImageData(new ImageData(pixels, ODD_WIDTH, ODD_HEIGHT), 0, 0);
    return createImageBitmap(source, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

/** Real-device quad renderer with the odd texture and a mapped readback of every render. */
export async function createOddTextureHarness(unavailable: string): Promise<OddTextureHarness> {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error(unavailable);
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
    const dispose = () => {
        quad.dispose();
        texture.destroy();
        bitmap.close();
        readback.destroy();
        target.destroy();
        device.destroy();
    };
    try {
        await quad.texture("odd", texture.createView());
    } catch (error) {
        dispose();
        throw error;
    }
    const swizzle = format === "bgra8unorm" ? [2, 1, 0, 3] : [0, 1, 2, 3];
    return {
        async render(frame) {
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
            return {
                bytes,
                read: (x, y) => swizzle.map((channel) => bytes[y * ROW_BYTES + x * 4 + channel]),
            };
        },
        async errors() {
            await device.queue.onSubmittedWorkDone();
            return errors;
        },
        dispose,
    };
}
