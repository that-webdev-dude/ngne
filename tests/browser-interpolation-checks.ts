import { Renderer } from "../src/index.js";
import type { Frame } from "../src/index.js";
import { checkInterpolation } from "./interpolation-scenario.js";

export async function checkBrowserInterpolation(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const canvas = document.querySelector<HTMLCanvasElement>("#interpolation");
    const select = document.querySelector<HTMLSelectElement>("#interpolation-frame");
    const conditions = document.querySelector("#interpolation-conditions");
    if (!canvas || !select || !conditions) throw new Error("Interpolation fixture elements missing");
    const renderer = new Renderer(canvas, 128, 96);
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 unavailable");
    const frames: Frame[] = [];
    const row = new Uint8Array(128 * 4);
    conditions.textContent = `128 × 96 logical/backing pixels; CSS 384 × 288; DPR ${window.devicePixelRatio}; ` +
        `fixed simulation 1/60 s; sampled alpha 0, .25, .5, .75, 1. ${navigator.userAgent}`;
    await checkInterpolation((condition, message) => {
        if (!condition) throw new Error(message);
    }, (frame, label, alpha) => {
        renderer.render(frame);
        // Read each sprite's horizontal center line; pixel centers lie at x + .5.
        for (let sprite = 0; sprite < 3; sprite++) {
            const offset = sprite * 13;
            const center = frame.data[offset];
            gl.readPixels(0, 96 - frame.data[offset + 1], 128, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
            const channel = sprite === 0 ? 1 : sprite === 1 ? 2 : 0;
            for (let x = 0; x < 128; x++) {
                const covered = x + 0.5 >= center - 4 && x + 0.5 < center + 4;
                if ((row[x * 4 + channel] === 255) !== covered)
                    throw new Error(`${label}, alpha ${alpha}, sprite ${sprite}: unexpected pixel at ${x}`);
            }
        }
        check(gl.getError() === gl.NO_ERROR, `${label}, alpha ${alpha}: numeric poses and GPU pixels`);
        frames.push(frame);
        const option = document.createElement("option");
        option.value = String(frames.length - 1);
        option.textContent = `${label} — alpha ${alpha}`;
        select.append(option);
    });
    select.addEventListener("change", () => {
        const frame = frames[Number(select.value)];
        if (frame) renderer.render(frame);
    });
    const first = frames[0];
    if (first) renderer.render(first);
    window.addEventListener("pagehide", () => renderer.dispose(), { once: true });
}
