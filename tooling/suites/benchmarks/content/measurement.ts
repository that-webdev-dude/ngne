import { assertDisposed, assertMounted, readSample } from "./accounting.js";

export function readMeasurement(value: unknown, count: number) {
    const object = (v: unknown): Record<string, unknown> => {
        if (!v || typeof v !== "object" || Array.isArray(v))
            throw Error("Missing measurement object");
        return v as Record<string, unknown>;
    };
    const v = object(value);
    if (
        v.status !== "passed" ||
        v.samplingComplete !== true ||
        !Array.isArray(v.failures) ||
        v.failures.length ||
        v.warmup !== 12 ||
        v.method !== "prepare-to-mounted-and-rendered-ordinary-frames-v1"
    )
        throw Error(`Invalid or failed measurement: ${JSON.stringify(v.failures)}`);
    if (
        !Array.isArray(v.samples) ||
        v.samples.length !== count ||
        !Array.isArray(v.cancellations) ||
        v.cancellations.length !== 3
    )
        throw Error("Incomplete samples or cancellation trials");
    const times = v.samples.map((item, i) => {
        const row = object(item);
        if (
            row.index !== (i + 1) % 12 ||
            typeof row.ms !== "number" ||
            !Number.isFinite(row.ms) ||
            row.ms < 0 ||
            (row.heap !== null &&
                (typeof row.heap !== "number" || !Number.isFinite(row.heap) || row.heap < 0))
        )
            throw Error("Invalid timing, heap or workload order");
        assertMounted(readSample(row.observed));
        return row.ms;
    });
    v.cancellations.forEach((item, i) => {
        const row = object(item);
        if (row.trial !== i) throw Error("Invalid cancellation order");
        assertMounted(readSample(row.before));
        assertMounted(readSample(row.after));
        const before = object(row.before),
            after = object(row.after);
        if (
            typeof before.closed !== "number" ||
            typeof after.closed !== "number" ||
            !Number.isSafeInteger(before.closed) ||
            !Number.isSafeInteger(after.closed) ||
            after.closed <= before.closed
        )
            throw Error("No late decoded image release");
    });
    assertDisposed(readSample(v.disposed));
    const environment = object(v.environment);
    if (
        environment.visibility !== "visible" ||
        !Array.isArray(environment.gpu) ||
        !environment.gpu.length ||
        environment.gpu.some((item) => object(item).isFallbackAdapter !== false)
    )
        throw Error("Invalid measurement GPU/visibility");
    if (
        !Array.isArray(environment.visibilityEvents) ||
        !environment.visibilityEvents.length ||
        environment.visibilityEvents.some((value) => value !== "visible")
    )
        throw Error("Workload became hidden");
    times.sort((a, b) => a - b);
    return {
        count: times.length,
        p50: times[Math.ceil(times.length * 0.5) - 1],
        p95: times[Math.ceil(times.length * 0.95) - 1],
        max: times.at(-1)!,
    };
}
