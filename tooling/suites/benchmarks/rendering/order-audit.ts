import type { Frame } from "../../../../src/renderer.js";

function numbers(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((entry: unknown) => typeof entry === "number");
}

/** Diagnostic inspection of existing runtime fields; no sorting or bucket/scatter implementation. */
export function auditOrder(frame: Frame) {
    const scenes: unknown = Reflect.get(frame, "scenes");
    const layers: unknown = Reflect.get(frame, "layers");
    const depths: unknown = Reflect.get(frame, "depths");
    if (!numbers(scenes) || !numbers(layers) || !numbers(depths))
        throw Error("Frame diagnostic key layout changed");
    if ([scenes, layers, depths].some((keys) => keys.length < frame.count))
        throw Error("Missing active keys");
    // Only this full scan is timed. Reflection, shape checks and distribution allocation are excluded.
    const start = performance.now();
    let identity = true,
        singleScene = true,
        commonDepth = true,
        safeLayers = true;
    let minLayer = Infinity,
        maxLayer = -Infinity;
    for (let i = 0; i < frame.count; i++) {
        identity &&= frame.order[i] === i;
        singleScene &&= scenes[i] === scenes[0];
        commonDepth &&= depths[i] === depths[0];
        safeLayers &&= Number.isSafeInteger(layers[i]);
        minLayer = Math.min(minLayer, layers[i]);
        maxLayer = Math.max(maxLayer, layers[i]);
    }
    const scanMs = performance.now() - start;
    const layerRange = maxLayer - minLayer + 1;
    const finiteDepth = frame.count > 0 && Number.isFinite(depths[0]);
    const distribution = new Map<string, number>();
    for (let i = 0; i < frame.count; i++) {
        const key = `${scenes[i]}/${layers[i]}/${depths[i]}`;
        distribution.set(key, (distribution.get(key) ?? 0) + 1);
    }
    return {
        count: frame.count,
        identity,
        singleScene,
        commonDepth,
        finiteDepth,
        safeLayers,
        minLayer: frame.count ? minLayer : null,
        maxLayer: frame.count ? maxLayer : null,
        layerRange: frame.count ? layerRange : 0,
        scanMs,
        // These are the issue's starting hypotheses, not approved thresholds.
        eligible4096x64:
            frame.count >= 4096 &&
            identity &&
            singleScene &&
            commonDepth &&
            finiteDepth &&
            safeLayers &&
            Number.isSafeInteger(layerRange) &&
            layerRange <= 64,
        keys: Object.fromEntries(distribution),
    };
}

/**
 * Mirrors the guards of `Frame.sort()`'s private layer-counting path on the authored
 * (pre-sort) frame and names the first one that fails. Diagnostic only: the fixture checks
 * this against the observed comparator use in the same tick.
 */
export function sortFastPathGuard(frame: Frame): {
    eligible: boolean;
    failingGuard: string | null;
} {
    const scenes: unknown = Reflect.get(frame, "scenes");
    const layers: unknown = Reflect.get(frame, "layers");
    const depths: unknown = Reflect.get(frame, "depths");
    if (!numbers(scenes) || !numbers(layers) || !numbers(depths))
        throw Error("Frame diagnostic key layout changed");
    const count = frame.count,
        fail = (failingGuard: string) => ({ eligible: false, failingGuard });
    if (count < 32768) return fail("count below 32,768");
    if (count > 262144) return fail("count above 262,144 (1 MiB index scratch cap)");
    const scene = scenes[0],
        depth = depths[0];
    if (!Number.isFinite(scene) || !Number.isFinite(depth))
        return fail("non-finite scene or depth");
    let min = layers[0],
        max = min,
        ordered = true,
        tail = -1;
    for (let i = 0; i < count; i++) {
        if (frame.order[i] !== i) return fail("non-identity input order");
        if (scenes[i] !== scene) return fail("more than one scene");
        if (!Number.isSafeInteger(layers[i])) return fail("non-integer layer");
        if (depths[i] !== depth) {
            tail = i;
            break;
        }
        if (layers[i] < max) ordered = false;
        min = Math.min(min, layers[i]);
        max = Math.max(max, layers[i]);
    }
    if (tail >= 0) {
        if (!ordered) return fail("mixed depths with out-of-order layers");
        for (let i = tail; i < count; i++) {
            if (frame.order[i] !== i) return fail("non-identity input order");
            if (scenes[i] !== scene) return fail("more than one scene");
            if (!Number.isSafeInteger(layers[i])) return fail("non-integer layer");
            if (!Number.isFinite(depths[i])) return fail("non-finite depth");
            if (
                layers[i] < layers[i - 1] ||
                (layers[i] === layers[i - 1] && depths[i] < depths[i - 1])
            )
                return fail("mixed depths not already in layer → depth order");
            min = Math.min(min, layers[i]);
            max = Math.max(max, layers[i]);
        }
    }
    const span = max - min + 1;
    if (!Number.isSafeInteger(span) || span > 64) return fail("layer span above 64");
    return { eligible: true, failingGuard: null };
}
