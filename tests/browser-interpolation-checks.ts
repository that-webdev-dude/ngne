import { centerX, centerY } from "./frame-values.js";
import type { Frame } from "../src/index.js";
import { checkInterpolation } from "./interpolation-scenario.js";
import { createQuadRenderer } from "../src/quad-renderer.js";
import { WebGPURenderer } from "../src/webgpu-renderer.js";

export async function checkBrowserInterpolation(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const canvas = document.querySelector<HTMLCanvasElement>("#interpolation");
    const select = document.querySelector<HTMLSelectElement>("#interpolation-frame");
    const conditions = document.querySelector("#interpolation-conditions");
    if (!canvas || !select || !conditions)
        throw new Error("Interpolation fixture elements missing");
    const samples: { frame: Frame; label: string; alpha: number }[] = [];
    conditions.textContent =
        `128 × 96 logical/backing pixels; CSS 384 × 288; DPR ${window.devicePixelRatio}; ` +
        `fixed simulation 1/60 s; sampled alpha 0, .25, .5, .75, 1. ${navigator.userAgent}`;
    await checkInterpolation(
        (condition, message) => {
            if (!condition) throw new Error(message);
        },
        (frame, label, alpha) => {
            samples.push({ frame, label, alpha });
            const option = document.createElement("option");
            option.value = String(samples.length - 1);
            option.textContent = `${label} — alpha ${alpha}`;
            select.append(option);
        },
    );
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Required WebGPU interpolation adapter unavailable");
    const device = await adapter.requestDevice();
    const format = navigator.gpu.getPreferredCanvasFormat();
    const quad = await createQuadRenderer(device, format);
    const target = device.createTexture({
        size: [128, 96],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
        size: 512 * 96,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const white = device.createTexture({
        size: [1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: white }, new Uint8Array([255, 255, 255, 255]), {}, [1, 1]);
    try {
        await quad.texture("", white.createView());
        for (const { frame, label, alpha } of samples) {
            quad.prepare(frame);
            const encoder = device.createCommandEncoder();
            quad.encode(encoder, target.createView(), frame, 128, 96, 0x090e20);
            encoder.copyTextureToBuffer(
                { texture: target },
                { buffer: readback, bytesPerRow: 512 },
                [128, 96],
            );
            device.queue.submit([encoder.finish()]);
            await readback.mapAsync(GPUMapMode.READ);
            const bytes = new Uint8Array(readback.getMappedRange());
            for (let sprite = 0; sprite < 3; sprite++) {
                const center = centerX(frame, sprite),
                    y = centerY(frame, sprite);
                const rgbaChannel = sprite === 0 ? 1 : sprite === 1 ? 2 : 0;
                const channel = format === "bgra8unorm" ? 2 - rgbaChannel : rgbaChannel;
                for (let x = 0; x < 128; x++) {
                    const covered = x + 0.5 >= center - 4 && x + 0.5 < center + 4;
                    if ((bytes[y * 512 + x * 4 + channel] === 255) !== covered)
                        throw new Error(
                            `${label}, alpha ${alpha}, sprite ${sprite}: unexpected pixel at ${x}`,
                        );
                }
            }
            readback.unmap();
            check(true, `WebGPU ${label}, alpha ${alpha}: numeric poses and GPU pixels`);
        }
    } finally {
        quad.dispose();
        readback.destroy();
        target.destroy();
        white.destroy();
        device.destroy();
    }
    const renderer = await WebGPURenderer.create(canvas, 128, 96);
    select.addEventListener("change", () => {
        const sample = samples[Number(select.value)];
        if (sample) renderer.render(sample.frame);
    });
    if (samples[0]) renderer.render(samples[0].frame);
    window.addEventListener("pagehide", () => renderer.dispose(), { once: true });
}
