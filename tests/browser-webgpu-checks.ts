import { createQuadRenderer } from "../src/quad-renderer.js";
import { Frame } from "../src/renderer.js";
import { uploadImage } from "../src/texture-assets.js";
import { WebGPURenderer } from "../src/webgpu-renderer.js";
import { Camera } from "../src/primitives.js";

/** Hardware evidence belongs to this test-owned device, never a WebGL adapter query. */
export async function checkWebGPUEnvironment(): Promise<void> {
    const output = document.getElementById("webgpu-environment");
    if (!output) throw new Error("Missing WebGPU environment output");
    const gpu = navigator.gpu;
    if (!gpu) {
        output.textContent =
            "WebGPU unavailable: enable hardware acceleration in a supported browser";
        return;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
        output.textContent = "WebGPU adapter unavailable: enable browser hardware acceleration";
        return;
    }
    const device = await adapter.requestDevice();
    try {
        output.textContent = JSON.stringify(
            {
                userAgent: navigator.userAgent,
                secureContext: window.isSecureContext,
                dpr: window.devicePixelRatio,
                format: gpu.getPreferredCanvasFormat(),
                adapter: {
                    vendor: adapter.info.vendor,
                    architecture: adapter.info.architecture,
                    device: adapter.info.device,
                    description: adapter.info.description,
                    isFallbackAdapter: adapter.info.isFallbackAdapter,
                },
                maxBufferSize: device.limits.maxBufferSize,
                maxTextureDimension2D: device.limits.maxTextureDimension2D,
            },
            null,
            2,
        );
    } finally {
        device.destroy();
    }
}

export async function checkWebGPUCore(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter)
        throw new Error("Required WebGPU checks unavailable; hardware acceptance is incomplete");
    const device = await adapter.requestDevice();
    const errors: string[] = [];
    device.addEventListener("uncapturederror", (event) => errors.push(event.error.message));
    const format = navigator.gpu.getPreferredCanvasFormat();
    const quad = await createQuadRenderer(device, format);
    const target = device.createTexture({
        size: [64, 64],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
        size: 256 * 64,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const white = device.createTexture({
        size: [1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: white }, new Uint8Array([255, 255, 255, 255]), {}, [1, 1]);
    const source = document.createElement("canvas");
    source.width = source.height = 2;
    const context = source.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    context.fillStyle = "#2040e0";
    context.fillRect(0, 0, 2, 2);
    const bitmap = await createImageBitmap(source, {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
    });
    const texture = await uploadImage(device, bitmap);
    let canvasRenderer: WebGPURenderer | undefined;
    try {
        await quad.texture("", white.createView());
        await quad.texture("blue", texture.createView());
        const frame = new Frame();
        frame.rect(16, 32, 32, 64, 0xe04020);
        frame.sprite({ x: 48, y: 32, width: 32, height: 64, texture: "blue" });
        quad.prepare(frame);
        const encoder = device.createCommandEncoder();
        quad.encode(encoder, target.createView(), frame, 64, 64, 0);
        encoder.copyTextureToBuffer(
            { texture: target },
            { buffer: readback, bytesPerRow: 256 },
            [64, 64],
        );
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(readback.getMappedRange());
        const pixel = (x: number) => {
            const offset = 32 * 256 + x * 4;
            return format === "bgra8unorm"
                ? [bytes[offset + 2], bytes[offset + 1], bytes[offset], bytes[offset + 3]]
                : Array.from(bytes.slice(offset, offset + 4));
        };
        const red = pixel(16),
            blue = pixel(48);
        check(
            red.join() === "224,64,32,255",
            "WebGPU solid quad and nonsymmetric channel swizzle match exact pixels",
        );
        check(
            blue.join() === "32,64,224,255",
            "WebGPU decoded texture, centered coordinates and WGSL layout match exact pixels",
        );
        readback.unmap();
        const readFrame = async (input: Frame, x = 32, y = 32) => {
            quad.prepare(input);
            const commands = device.createCommandEncoder();
            quad.encode(commands, target.createView(), input, 64, 64, 0);
            commands.copyTextureToBuffer(
                { texture: target },
                { buffer: readback, bytesPerRow: 256 },
                [64, 64],
            );
            device.queue.submit([commands.finish()]);
            await readback.mapAsync(GPUMapMode.READ);
            const mapped = new Uint8Array(readback.getMappedRange());
            const offset = y * 256 + x * 4;
            const pixel =
                format === "bgra8unorm"
                    ? [mapped[offset + 2], mapped[offset + 1], mapped[offset], mapped[offset + 3]]
                    : Array.from(mapped.slice(offset, offset + 4));
            readback.unmap();
            return pixel;
        };
        const ordered = new Frame();
        const camera = new Camera();
        ordered.scene(camera, 1);
        ordered.sprite({
            x: 32,
            y: 32,
            width: 64,
            height: 64,
            color: 0xff0000,
            layer: 1,
            depth: 9,
        });
        ordered.sprite({
            x: 32,
            y: 32,
            width: 64,
            height: 64,
            color: 0x00ff00,
            layer: 1,
            depth: 2,
        });
        check(
            (await readFrame(ordered)).join() === "255,0,0,255",
            "WebGPU depth order outranks insertion within a layer",
        );
        ordered.sprite({
            x: 32,
            y: 32,
            width: 64,
            height: 64,
            color: 0x0000ff,
            layer: 1,
            depth: 9,
        });
        check(
            (await readFrame(ordered)).join() === "0,0,255,255",
            "WebGPU insertion resolves equal layer and depth",
        );
        ordered.rect(32, 32, 64, 64, 0x00ff00, 1, 2);
        check(
            (await readFrame(ordered)).join() === "0,255,0,255",
            "WebGPU layer order outranks depth",
        );
        ordered.scene(camera, 1);
        ordered.rect(32, 32, 64, 64, 0xe04020, 1, -100);
        check(
            (await readFrame(ordered)).join() === "224,64,32,255",
            "WebGPU scene order outranks local layer and depth",
        );
        ordered.reset();
        ordered.sprite({
            x: 32,
            y: 32,
            width: 32,
            height: 32,
            color: 0xff0000,
            alpha: 0.5,
            layer: 3,
        });
        ordered.sprite({ x: 32, y: 32, width: 32, height: 32, texture: "blue", layer: 1 });
        ordered.sprite({
            x: 32,
            y: 32,
            width: 32,
            height: 32,
            color: 0x00ff00,
            alpha: 0.5,
            layer: 2,
        });
        const overlap = await readFrame(ordered);
        check(
            Math.abs(overlap[0] - 136) <= 2 &&
                Math.abs(overlap[1] - 80) <= 2 &&
                Math.abs(overlap[2] - 56) <= 2,
            "WebGPU layer-sorted translucent overlap preserves compositing order",
        );
        ordered.reset();
        ordered.rect(32, 32, 64, 64, 0xff0000);
        ordered.sprite({ x: 32, y: 32, width: 64, height: 64, texture: "blue" });
        ordered.rect(32, 32, 64, 64, 0x00ff00, 0.5);
        await readFrame(ordered);
        check(quad.stats.drawCalls === 3, "WebGPU A/B/A remains three adjacent runs");
        ordered.reset();
        const empty = await readFrame(ordered);
        check(
            empty.join() === "0,0,0,255" && quad.stats.drawCalls === 0,
            "WebGPU empty frame clears without drawing",
        );
        for (let i = 0; i < 10000; i++) ordered.rect(32, 32, 2, 2, 0xffffff);
        await readFrame(ordered);
        check(
            quad.stats.sprites === 10000 &&
                quad.stats.drawCalls === 1 &&
                quad.stats.uploadedBytes === 560048 &&
                quad.stats.capacity >= 10000,
            "WebGPU grows to 10,000 sprites with one active-range upload and one draw",
        );
        const capacity = quad.stats.capacity,
            growths = quad.stats.bufferGrowths;
        ordered.reset();
        ordered.rect(32, 32, 2, 2, 0xffffff);
        await readFrame(ordered);
        check(
            quad.stats.uploadedBytes === 104 &&
                quad.stats.capacity === capacity &&
                quad.stats.bufferGrowths === growths,
            "WebGPU reuses grown buffers and uploads only active instances",
        );
        context.putImageData(
            new ImageData(
                new Uint8ClampedArray([
                    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 240, 80, 160, 128,
                ]),
                2,
                2,
            ),
            0,
            0,
        );
        const uvBitmap = await createImageBitmap(source, {
            premultiplyAlpha: "none",
            colorSpaceConversion: "none",
        });
        const uvTexture = await uploadImage(device, uvBitmap);
        try {
            await quad.texture("uv", uvTexture.createView());
            for (const [u, v, expected] of [
                [0, 0, [255, 0, 0]],
                [0.5, 0, [0, 255, 0]],
                [0, 0.5, [0, 0, 255]],
            ] as const) {
                ordered.reset();
                ordered.sprite({
                    x: 32,
                    y: 32,
                    width: 32,
                    height: 32,
                    texture: "uv",
                    u,
                    v,
                    uw: 0.5,
                    vh: 0.5,
                    rotation: 0.73,
                });
                check(
                    (await readFrame(ordered)).slice(0, 3).join() === expected.join(),
                    `WebGPU UV quadrant ${u},${v} and center rotation`,
                );
            }
            ordered.reset();
            ordered.sprite({
                x: 32,
                y: 32,
                width: -32,
                height: 32,
                texture: "uv",
                u: 0.5,
                v: 0.5,
                uw: 0.5,
                vh: 0.5,
                alpha: 0.5,
            });
            const translucent = await readFrame(ordered);
            const decoded = context.getImageData(1, 1, 1, 1).data;
            check(
                [0, 1, 2].every(
                    (channel) =>
                        Math.abs(
                            translucent[channel] - ((decoded[channel] * decoded[3]) / 255) * 0.5,
                        ) <= 2,
                ),
                "WebGPU translucent source times sprite alpha premultiplies once with signed geometry",
            );
        } finally {
            quad.release("uv");
            uvTexture.destroy();
            uvBitmap.close();
        }
        context.fillStyle = "#2040e0";
        context.fillRect(0, 0, 2, 2);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        canvas.style.cssText = "width:128px;height:128px;image-rendering:pixelated";
        canvas.setAttribute("aria-label", "WebGPU reference red and blue quads");
        document.getElementById("webgpu-environment")?.after(canvas);
        canvasRenderer = await WebGPURenderer.create(canvas, 64, 64, (error) =>
            errors.push(String(error)),
        );
        await canvasRenderer.texture("blue", source);
        canvasRenderer.render(frame);
        // Preserve the real canvas result for visual inspection after GPU teardown.
        const reference = document.createElement("canvas");
        reference.width = reference.height = 64;
        reference.style.cssText = canvas.style.cssText;
        reference.setAttribute("aria-label", "Captured WebGPU reference pixels");
        const capture = reference.getContext("2d");
        if (!capture) throw new Error("Reference capture unavailable");
        capture.drawImage(canvas, 0, 0);
        canvas.replaceWith(reference);
        check(
            canvasRenderer.drawCalls === 2 && canvasRenderer.sprites === 2,
            "WebGPU canvas presents two adjacent texture runs",
        );
        await device.queue.onSubmittedWorkDone();
        check(
            errors.length === 0,
            "WebGPU core completes with zero validation errors: " + errors.join("; "),
        );
    } finally {
        canvasRenderer?.dispose();
        quad.dispose();
        white.destroy();
        texture.destroy();
        bitmap.close();
        readback.destroy();
        target.destroy();
        device.destroy();
    }
}
