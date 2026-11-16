/**
 * Rectangle in integer render-target (backing) pixels with a top-left origin and exclusive
 * right/bottom edges. It is neither in CSS pixels nor scaled by the device pixel ratio.
 */
export interface ClipRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

const number = (value: unknown) => (typeof value === "number" ? value : Number.NaN);

/**
 * Per-sprite clip snapshots indexed by insertion, so they follow any sort order. A frame
 * without clipped sprites never writes here; its first clipped sprite marks earlier ones
 * unclipped, and every later sprite writes its own flag.
 */
export class SpriteClips {
    private values = new Float64Array(0);
    private flags = new Uint8Array(0);
    private readonly scratch = new Float64Array(4);
    /** Marks sprites before `index` unclipped when a frame records its first clip. */
    begin(index: number): void {
        this.reserve(index + 1);
        this.flags.fill(0, 0, index);
    }
    /** Copies the caller's values; validation waits until frame preparation. */
    set(index: number, clip: ClipRect): void {
        this.reserve(index + 1);
        const o = index * 4,
            values = this.values,
            // A null or primitive clip records invalid values instead of throwing while authoring.
            source: Partial<ClipRect> = typeof clip === "object" && clip !== null ? clip : {};
        values[o] = number(source.x);
        values[o + 1] = number(source.y);
        values[o + 2] = number(source.width);
        values[o + 3] = number(source.height);
        this.flags[index] = 1;
    }
    none(index: number): void {
        this.reserve(index + 1);
        this.flags[index] = 0;
    }
    /** Throws before encoding when any clip in the active prefix is invalid. */
    validate(count: number): void {
        const values = this.values;
        for (let i = 0; i < count; i++) {
            if (!this.flags[i]) continue;
            const o = i * 4,
                x = values[o],
                y = values[o + 1],
                width = values[o + 2],
                height = values[o + 3];
            if (
                !Number.isSafeInteger(x) ||
                !Number.isSafeInteger(y) ||
                !Number.isSafeInteger(width) ||
                !Number.isSafeInteger(height) ||
                width < 0 ||
                height < 0 ||
                !Number.isSafeInteger(x + width) ||
                !Number.isSafeInteger(y + height)
            )
                throw new RangeError(
                    "Invalid sprite clip: x, y, width and height must be safe integers; width and height must not be negative",
                );
        }
    }
    /**
     * Writes the effective scissor `[left, top, right, bottom]` of sprite `index` within a
     * `width` × `height` attachment. Unclipped sprites cover the attachment; an empty
     * intersection is all zeros, so every empty clip compares equal.
     */
    bounds(index: number, width: number, height: number, out: Float64Array): void {
        if (!this.flags[index]) {
            out[0] = out[1] = 0;
            out[2] = width;
            out[3] = height;
            return;
        }
        const o = index * 4,
            values = this.values,
            left = Math.max(values[o], 0),
            top = Math.max(values[o + 1], 0),
            right = Math.min(values[o] + values[o + 2], width),
            bottom = Math.min(values[o + 1] + values[o + 3], height);
        if (right <= left || bottom <= top) {
            out.fill(0);
            return;
        }
        out[0] = left;
        out[1] = top;
        out[2] = right;
        out[3] = bottom;
    }
    /** Whether sprite `index` has the same effective scissor as `run`. */
    matches(index: number, width: number, height: number, run: Float64Array): boolean {
        const next = this.scratch;
        this.bounds(index, width, height, next);
        return next[0] === run[0] && next[1] === run[1] && next[2] === run[2] && next[3] === run[3];
    }
    private reserve(count: number): void {
        if (count <= this.flags.length) return;
        let capacity = Math.max(this.flags.length, 2048);
        while (capacity < count) capacity *= 2;
        const flags = new Uint8Array(capacity),
            values = new Float64Array(capacity * 4);
        flags.set(this.flags);
        values.set(this.values);
        this.flags = flags;
        this.values = values;
    }
}
