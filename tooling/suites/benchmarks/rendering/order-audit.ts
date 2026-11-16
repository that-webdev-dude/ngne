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
        throw new Error("Frame diagnostic key layout changed");
    if ([scenes, layers, depths].some((keys) => keys.length < frame.count))
        throw new Error("Missing active keys");
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
 * Names the first failing guard of `Frame.sort()`'s private layer-counting path on the
 * authored (pre-sort) frame. It copies the private bounds (32,768, 262,144, span 64) and
 * guard order from `src/renderer.ts`, so it is for naming only: the fixture's observed
 * comparator call is ground truth, and its `guardAgrees` field exposes drift. Update this
 * mirror and `tooling/tests/order-diagnostics.test.ts` with any change to those guards.
 */
interface GuardKeys {
    order: readonly number[];
    scenes: number[];
    layers: number[];
    depths: number[];
    scene: number;
}

/** Guards every entry shares: identity input order, one scene, safe-integer layer. */
function entryGuard(keys: GuardKeys, i: number): string | null {
    if (keys.order[i] !== i) return "non-identity input order";
    if (keys.scenes[i] !== keys.scene) return "more than one scene";
    if (!Number.isSafeInteger(keys.layers[i])) return "non-integer layer";
    return null;
}

/** From the first depth change on, entries must already be in layer → depth order. */
function depthTailGuard(keys: GuardKeys, start: number, count: number): string | null {
    const { layers, depths } = keys;
    for (let i = start; i < count; i++) {
        const entry = entryGuard(keys, i);
        if (entry) return entry;
        if (!Number.isFinite(depths[i])) return "non-finite depth";
        if (layers[i] < layers[i - 1] || (layers[i] === layers[i - 1] && depths[i] < depths[i - 1]))
            return "mixed depths not already in layer → depth order";
    }
    return null;
}

function layerSpan(layers: number[], count: number): number {
    let min = layers[0],
        max = min;
    for (let i = 1; i < count; i++) {
        min = Math.min(min, layers[i]);
        max = Math.max(max, layers[i]);
    }
    return max - min + 1;
}

export function sortFastPathGuard(frame: Frame): {
    eligible: boolean;
    failingGuard: string | null;
} {
    const scenes: unknown = Reflect.get(frame, "scenes");
    const layers: unknown = Reflect.get(frame, "layers");
    const depths: unknown = Reflect.get(frame, "depths");
    if (!numbers(scenes) || !numbers(layers) || !numbers(depths))
        throw new Error("Frame diagnostic key layout changed");
    const count = frame.count,
        fail = (failingGuard: string) => ({ eligible: false, failingGuard });
    if (count < 32768) return fail("count below 32,768");
    if (count > 262144) return fail("count above 262,144 (1 MiB index scratch cap)");
    const scene = scenes[0],
        depth = depths[0];
    if (!Number.isFinite(scene) || !Number.isFinite(depth))
        return fail("non-finite scene or depth");
    const keys: GuardKeys = { order: frame.order, scenes, layers, depths, scene };
    let ordered = true,
        max = layers[0];
    for (let i = 0; i < count; i++) {
        const entry = entryGuard(keys, i);
        if (entry) return fail(entry);
        if (depths[i] !== depth) {
            if (!ordered) return fail("mixed depths with out-of-order layers");
            const tail = depthTailGuard(keys, i, count);
            if (tail) return fail(tail);
            break;
        }
        if (layers[i] < max) ordered = false;
        max = Math.max(max, layers[i]);
    }
    // Reached only when every entry passed, so the span covers the whole active prefix.
    const span = layerSpan(layers, count);
    if (!Number.isSafeInteger(span) || span > 64) return fail("layer span above 64");
    return { eligible: true, failingGuard: null };
}
