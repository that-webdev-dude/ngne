import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { Camera } from "../src/primitives.js";
import { QUAD_STRIDE } from "../src/quad-layout.js";
import { Frame, frameClips, type Sprite } from "../src/renderer.js";
import type { ClipRect } from "../src/sprite-clip.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";
import { fakeBitmap, fakePlatform, type FakeDevice } from "./gpu-fixture.js";

// Digests pin the authoring output of the revision before the unclipped-preparation change:
// packed instance bytes, textures, sort order, per-sprite clip assignment, encoded scissors and
// draws, and upload sizes. Any change to them is a behaviour change, not a refactor.
const EXPECTED: Record<string, string> = {
    "none snap=false zoom=false": "0fa0b31ed2d3ccd8",
    "shared snap=false zoom=false": "b12d1241bc7caff4",
    "alternating snap=false zoom=false": "8d8176aaf18088e2",
    "unclippedThenClipped snap=false zoom=false": "31b99b3230ae9f59",
    "clippedThenUnclipped snap=false zoom=false": "88b74f53d32abf02",
    "none snap=false zoom=true": "816509aa0dd92246",
    "shared snap=false zoom=true": "2652660cf0280eaa",
    "alternating snap=false zoom=true": "e6a9a9b36c09355d",
    "unclippedThenClipped snap=false zoom=true": "a1c558a5e6cd2626",
    "clippedThenUnclipped snap=false zoom=true": "d796b7225087fece",
    "none snap=true zoom=false": "18334bc754cb036f",
    "shared snap=true zoom=false": "058bceeafcb6315f",
    "alternating snap=true zoom=false": "2a141a9ee427bf30",
    "unclippedThenClipped snap=true zoom=false": "c7706294253eea27",
    "clippedThenUnclipped snap=true zoom=false": "6171ca6a1f955639",
    "none snap=true zoom=true": "e1b783e7653f31b3",
    "shared snap=true zoom=true": "8557dadf3fd8498e",
    "alternating snap=true zoom=true": "cb43aeef9aa45e64",
    "unclippedThenClipped snap=true zoom=true": "07d8b876c484074c",
    "clippedThenUnclipped snap=true zoom=true": "f7cb5fe80db845cb",
    "reused grown": "79ba92b5436d83b7",
    "reused reset smaller": "16feb344dffa72c9",
    "reused reset regrown": "154cdef275050d90",
    "reused reset unclipped after clips": "8e5db3bccc0b798e",
};

const A: ClipRect = { x: 4, y: 6, width: 20, height: 10 },
    B: ClipRect = { x: 30, y: 1, width: 16, height: 40 };
const PATTERNS = {
    none: () => undefined,
    shared: () => A,
    alternating: (i: number) => [A, B, undefined][i % 3],
    unclippedThenClipped: (i: number, n: number) => (i < n / 2 ? undefined : A),
    clippedThenUnclipped: (i: number, n: number) => (i < n / 2 ? A : undefined),
} satisfies Record<string, (i: number, n: number) => ClipRect | undefined>;
type Pattern = keyof typeof PATTERNS;

/** Fixed-seed generator (mulberry32) so every run authors the same sprites. */
function random(seed: number) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const pick = <T>(next: () => number, values: readonly T[]) =>
    values[Math.floor(next() * values.length)];

/** Authors `count` sprites, every seventh as a rect, into `frame` under `pattern`. */
function author(frame: Frame, count: number, pattern: Pattern, seed: number) {
    const next = random(seed);
    for (let i = 0; i < count; i++) {
        const x = next() * 120 - 20,
            y = next() * 90 - 10;
        if (i % 7 === 6) {
            frame.rect(x, y, pick(next, [3, 4, 9.5]), pick(next, [2, 5, 6]), 0x40a0c0, 0.5, 1);
            continue;
        }
        const sprite: Sprite = {
            x,
            y,
            width: pick(next, [4, 5, -6, 7.5, 16, 1]),
            height: pick(next, [4, 3, -2, 8.25, 16]),
            rotation: pick(next, [undefined, 0, Math.PI / 2, Math.PI, 0.3, -1.1]),
            color: pick(next, [undefined, Math.floor(next() * 0x1000000)]),
            alpha: pick(next, [undefined, 0.25, 1]),
            layer: pick(next, [undefined, 0, 1, -2]),
            depth: pick(next, [undefined, 0, 0.5]),
            texture: pick(next, [undefined, "a", "b"]),
            screen: pick(next, [false, false, false, true]),
        };
        if (next() < 0.3) Object.assign(sprite, { u: 0.25, v: 0.5, uw: 0.5, vh: 0.25 });
        const clip = PATTERNS[pattern](i, count);
        // An explicit `clip: undefined` and an absent property must author the same frame.
        if (clip !== undefined || i % 2) sprite.clip = clip;
        frame.sprite(sprite);
    }
}

function camera(snap: boolean, zoomed: boolean) {
    const camera = new Camera();
    camera.pixelSnap = snap;
    if (zoomed) camera.cut(3.25, -7.5, 2.5);
    return camera;
}

async function setup() {
    const platform = fakePlatform(),
        diagnostics: unknown[] = [];
    const runtime = await WebGpuRuntime.create(
        platform.canvas,
        64,
        64,
        (e) => diagnostics.push(e),
        { ...platform, snapshot: async () => fakeBitmap().image },
    );
    await runtime.texture("a", fakeBitmap().image);
    await runtime.texture("b", fakeBitmap().image);
    return { device: platform.devices[0], runtime, diagnostics };
}

/** Digest of everything the frame packed and everything the runtime encoded and uploaded. */
function digest(runtime: WebGpuRuntime, device: FakeDevice, frame: Frame) {
    const hash = createHash("sha256");
    hash.update(new Uint8Array(frame.data.buffer, 0, frame.count * QUAD_STRIDE * 4));
    const clips = frameClips(frame),
        bounds = new Float64Array(4),
        assigned: string[] = [];
    for (let i = 0; i < frame.count; i++) {
        if (!clips) assigned.push("full");
        else {
            clips.bounds(i, 64, 64, bounds);
            assigned.push(bounds.join(","));
        }
    }
    const commands = device.commands.length;
    runtime.render(frame, 0);
    const write = device.writes.at(-1);
    hash.update(
        JSON.stringify({
            count: frame.count,
            textures: frame.textures.slice(0, frame.count),
            order: frame.order,
            assigned,
            encoded: device.commands.slice(commands),
            drawCalls: runtime.drawCalls,
            uploadedBytes: runtime.stats?.uploadedBytes,
            write: write && { size: write.size, dataLength: write.dataLength },
        }),
    );
    return hash.digest("hex").slice(0, 16);
}

test("unclipped, shared, alternating and mixed clip frames pack and encode identically", async () => {
    const { device, runtime, diagnostics } = await setup();
    try {
        const actual: Record<string, string> = {};
        for (const snap of [false, true])
            for (const zoomed of [false, true])
                for (const pattern of Object.keys(PATTERNS) as Pattern[]) {
                    const frame = new Frame();
                    frame.scene(camera(snap, zoomed), 1);
                    author(frame, 257, pattern, 62);
                    actual[`${pattern} snap=${snap} zoom=${zoomed}`] = digest(
                        runtime,
                        device,
                        frame,
                    );
                }
        // One reused frame: growth past the initial 2048 instances, then reset to fewer
        // sprites, then a different clip pattern, so stale clip flags would show.
        const reused = new Frame();
        for (const [step, pattern, count] of [
            ["grown", "alternating", 2100],
            ["reset smaller", "none", 300],
            ["reset regrown", "clippedThenUnclipped", 2100],
            ["reset unclipped after clips", "none", 2100],
        ] as const) {
            reused.reset();
            reused.scene(camera(true, step !== "grown"), 0.5);
            author(reused, count, pattern, 7);
            actual[`reused ${step}`] = digest(runtime, device, reused);
        }
        assert.equal(diagnostics.length, 0);
        assert.deepEqual(actual, EXPECTED);
    } finally {
        runtime.dispose();
    }
});
