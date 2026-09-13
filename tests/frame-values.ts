import type { Frame } from "../src/renderer.js";
import { QUAD_STRIDE } from "../src/quad-layout.js";

/** Independently reconstruct the authoring center from the packed unit-quad transform. */
export function centerX(frame: Frame, sprite = 0): number {
    const offset = sprite * QUAD_STRIDE;
    return frame.data[offset] + (frame.data[offset + 2] + frame.data[offset + 4]) / 2;
}
export function centerY(frame: Frame, sprite = 0): number {
    const offset = sprite * QUAD_STRIDE;
    return frame.data[offset + 1] + (frame.data[offset + 3] + frame.data[offset + 5]) / 2;
}
