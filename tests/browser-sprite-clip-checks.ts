import { Camera } from "../src/primitives.js";
import { Frame, type Sprite } from "../src/renderer.js";
import type { ClipRect } from "../src/sprite-clip.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";

/** Logical 64×64 over an 80×80 backing: a device pixel ratio of 1.25 with no implicit scaling. */
const LOGICAL = 64,
    BACKING = 80;

interface Scenario {
    name: string;
    clip: ClipRect;
    /** Clipped sprites take the scenario clip; the others stay unclipped. */
    sprites: { sprite: Sprite; clipped: boolean }[];
    camera?: () => Camera;
}

const clipped = (sprite: Sprite) => ({ sprite, clipped: true });
const plain = (sprite: Sprite) => ({ sprite, clipped: false });

function movingCamera(pixelSnap: boolean): () => Camera {
    return () => {
        const camera = new Camera();
        camera.cut(5, 3, 1.5);
        camera.x = 6.4;
        camera.zoom = 1.75;
        camera.shakeX = 0.6;
        camera.shakeY = -1.3;
        camera.pixelSnap = pixelSnap;
        return camera;
    };
}

const worldAndScreen = (pixelSnap: boolean): Scenario => ({
    name: `world and screen sprites under a moving camera, pixelSnap ${pixelSnap}`,
    clip: { x: 10, y: 12, width: 57, height: 41 },
    camera: movingCamera(pixelSnap),
    sprites: [
        plain({ x: 30, y: 30, width: 60, height: 60, color: 0x203040 }),
        clipped({ x: 20, y: 20, width: 30, height: 24, color: 0xe0a020, rotation: 0.3 }),
        clipped({ x: 50, y: 44, width: 21, height: 19, color: 0x20c0e0, screen: true }),
    ],
});

const SCENARIOS: Scenario[] = [
    {
        name: "solid sprite fills exactly its clip",
        clip: { x: 13, y: 7, width: 21, height: 11 },
        sprites: [clipped({ x: 32, y: 32, width: 64, height: 64, color: 0x40c080 })],
    },
    {
        name: "rotated, flipped UV subrectangle",
        clip: { x: 20, y: 15, width: 30, height: 33 },
        sprites: [
            clipped({
                x: 30,
                y: 28,
                width: -36,
                height: 30,
                rotation: 0.6,
                texture: "clip-texels",
                u: 0.25,
                v: 0.25,
                uw: 0.5,
                vh: 0.75,
            }),
        ],
    },
    {
        name: "translucent overlap across layers, partially outside the target",
        clip: { x: -6, y: 30, width: 50, height: 100 },
        sprites: [
            clipped({ x: 36, y: 36, width: 40, height: 40, color: 0xff4020, alpha: 0.5, layer: 2 }),
            plain({ x: 28, y: 28, width: 40, height: 40, color: 0x2060ff, alpha: 0.6, layer: 1 }),
            plain({ x: 40, y: 20, width: 20, height: 20, color: 0x20ff60, alpha: 0.4, layer: 3 }),
        ],
    },
    worldAndScreen(true),
    worldAndScreen(false),
    {
        name: "clip starting at the right edge draws nothing",
        clip: { x: BACKING, y: 0, width: 10, height: 10 },
        sprites: [
            plain({ x: 10, y: 10, width: 12, height: 12, color: 0x8080ff }),
            clipped({ x: 32, y: 32, width: 64, height: 64, color: 0xff8080 }),
        ],
    },
    {
        name: "zero-width clip draws nothing",
        clip: { x: 10, y: 10, width: 0, height: 20 },
        sprites: [clipped({ x: 32, y: 32, width: 64, height: 64, color: 0xff8080 })],
    },
];

const inside = (clip: ClipRect, x: number, y: number) =>
    x >= clip.x && x < clip.x + clip.width && y >= clip.y && y < clip.y + clip.height;

/**
 * Returns the first pixel where the clipped render breaks the rule, the count of in-clip
 * pixels the clipped sprites change, and the count of out-of-clip pixels the clip cut away.
 */
function compareClip(
    clip: ClipRect,
    width: number,
    height: number,
    renders: { full: Uint8ClampedArray; without: Uint8ClampedArray; clipped: Uint8ClampedArray },
) {
    let mismatch = "",
        shown = 0,
        cut = 0;
    for (let y = 0; y < height && !mismatch; y++)
        for (let x = 0; x < width && !mismatch; x++) {
            const o = (y * width + x) * 4,
                within = inside(clip, x, y),
                pixel = (bytes: Uint8ClampedArray) => bytes.subarray(o, o + 4).join();
            const unclipped = pixel(renders.full),
                absent = pixel(renders.without),
                actual = pixel(renders.clipped),
                wanted = within ? unclipped : absent;
            if (actual !== wanted) mismatch = ` (${x},${y}: ${actual} != ${wanted})`;
            // The scenario must show clipped content and also cut some away.
            if (within && unclipped !== absent) shown++;
            if (!within && actual !== unclipped) cut++;
        }
    return { mismatch, shown, cut };
}

/**
 * Sprite clips scissor exactly in backing pixels: inside the clip a clipped render equals
 * the unclipped one, outside it equals the render without the clipped sprites.
 */
export async function checkBrowserSpriteClip(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const devices: GPUDevice[] = [],
        diagnostics: unknown[] = [];
    const requestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (descriptor?: GPUDeviceDescriptor) {
        const device = await requestDevice.call(this, descriptor);
        devices.push(device);
        return device;
    };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = BACKING;
    canvas.setAttribute("aria-label", "WebGPU sprite clip canvas");
    document.body.append(canvas);
    let runtime: WebGpuRuntime | undefined;
    const reader = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!reader) throw new Error("Canvas readback unavailable");
    try {
        runtime = await WebGpuRuntime.create(canvas, LOGICAL, LOGICAL, (error) =>
            diagnostics.push(error),
        );
        const texels = document.createElement("canvas");
        texels.width = texels.height = 4;
        const paint = texels.getContext("2d");
        if (!paint) throw new Error("Canvas 2D unavailable");
        for (let i = 0; i < 16; i++) {
            paint.fillStyle = `rgb(${40 + 13 * i}, ${220 - 11 * i}, ${(i % 4) * 60})`;
            paint.fillRect(i % 4, Math.floor(i / 4), 1, 1);
        }
        await runtime.texture("clip-texels", texels);
        const active = runtime;
        const snapshot = (scenario: Scenario, variant: "full" | "without" | "clipped") => {
            const frame = new Frame();
            frame.scene(scenario.camera?.() ?? new Camera(), 0.5);
            for (const { sprite, clipped } of scenario.sprites) {
                if (!clipped || variant === "full") frame.sprite(sprite);
                else if (variant === "clipped") frame.sprite({ ...sprite, clip: scenario.clip });
            }
            active.render(frame, 0x101010);
            reader.canvas.width = canvas.width;
            reader.canvas.height = canvas.height;
            reader.drawImage(canvas, 0, 0);
            return reader.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const verify = (phase: string) => {
            const results: Uint8ClampedArray[] = [];
            for (const scenario of SCENARIOS) {
                const full = snapshot(scenario, "full"),
                    without = snapshot(scenario, "without"),
                    clip = snapshot(scenario, "clipped");
                const { mismatch, shown, cut } = compareClip(
                    scenario.clip,
                    canvas.width,
                    canvas.height,
                    { full, without, clipped: clip },
                );
                const empty = scenario.clip.width === 0 || scenario.clip.x >= canvas.width;
                check(
                    !mismatch && cut > 0 && (empty || shown > 0),
                    `WebGPU sprite clip ${phase}: ${scenario.name}${mismatch}`,
                );
                results.push(clip);
            }
            return results;
        };
        verify(`at ${BACKING}×${BACKING} backing for ${LOGICAL}×${LOGICAL} logical`);
        runtime.resize(48, 40);
        canvas.width = 60;
        canvas.height = 50;
        const before = verify("after resize to 48×40 logical over 60×50 backing");
        devices[0].destroy();
        await devices[0].lost;
        await runtime.ready();
        const after = SCENARIOS.map((scenario) => snapshot(scenario, "clipped"));
        check(
            devices.length === 2 &&
                runtime.status === "ready" &&
                after.every((bytes, i) => bytes.every((value, j) => value === before[i][j])),
            "WebGPU sprite clips survive controlled device loss with byte-identical pixels",
        );
        const invalid = new Frame();
        invalid.sprite({
            x: 8,
            y: 8,
            width: 4,
            height: 4,
            clip: { x: 0.5, y: 0, width: 4, height: 4 },
        });
        runtime.render(invalid, 0);
        const rejected =
            diagnostics.length === 1 && String(diagnostics[0]).includes("Invalid sprite clip");
        snapshot(SCENARIOS[0], "clipped");
        check(
            rejected && runtime.drawCalls === 1,
            "WebGPU sprite clip rejects a fractional rectangle before encoding and renders the next frame",
        );
        await devices[1].queue.onSubmittedWorkDone();
        check(
            diagnostics.length === 1,
            "WebGPU sprite clip has zero validation errors beyond the rejected rectangle: " +
                diagnostics.map(String).join("; "),
        );
    } finally {
        GPUAdapter.prototype.requestDevice = requestDevice;
        runtime?.dispose();
        canvas.remove();
    }
}
