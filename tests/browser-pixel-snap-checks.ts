import { QUAD_STRIDE } from "../src/quad-layout.js";
import { Frame } from "../src/renderer.js";
import { Camera } from "../src/primitives.js";
import {
    CLEAR,
    ODD_HEIGHT as HEIGHT,
    ODD_WIDTH as WIDTH,
    createOddTextureHarness,
    findMismatch,
    oddTexel as texel,
} from "./browser-odd-texture-harness.js";

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

/** Odd-sized snapped quads at fractional positions map each texel to exactly one pixel. */
export async function checkBrowserPixelSnap(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const harness = await createOddTextureHarness("Required WebGPU pixel-snap checks unavailable");
    try {
        const frame = new Frame();
        const cases = packCases(frame);
        const { read } = await harness.render(frame);
        for (const snap of cases) {
            const mismatch = findMismatch(
                read,
                { left: snap.left, top: snap.top, width: WIDTH, height: HEIGHT },
                (px, py) => expectedPixel(snap, px, py),
            );
            const detail = mismatch ? ` (${mismatch})` : "";
            check(
                Number.isInteger(snap.left) && Number.isInteger(snap.top) && !mismatch,
                `WebGPU pixel snap ${snap.label}: ${WIDTH}×${HEIGHT} texels map 1:1 at ${snap.left},${snap.top}${detail}`,
            );
        }
        const errors = await harness.errors();
        check(
            errors.length === 0,
            "WebGPU pixel snap has zero validation errors: " + errors.join("; "),
        );
    } finally {
        harness.dispose();
    }
}
