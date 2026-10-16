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
