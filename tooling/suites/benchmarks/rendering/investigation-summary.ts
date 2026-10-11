export function distribution(values: readonly number[]) {
    if (!values.length || values.some((value) => !Number.isFinite(value)))
        throw Error("Expected finite measurement samples");
    const sorted = [...values].sort((a, b) => a - b);
    const at = (fraction: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
    return {
        count: values.length,
        p50: at(0.5),
        p95: at(0.95),
        p99: at(0.99),
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
    };
}

export interface FrameMeasurements {
    columns: string[];
    samples: number[][];
    begin: number;
    end: number;
}

export function summarizeFrames(input: FrameMeasurements) {
    const { columns, begin, end } = input;
    if (columns[0] !== "time" || !(end > begin)) throw Error("Invalid measurement window");
    const samples = input.samples.filter((row) => row[0] >= begin && row[0] < end);
    if (!samples.length || samples.some((row) => row.length !== columns.length))
        throw Error("Missing or malformed frames");
    const metrics = Object.fromEntries(
        columns
            .slice(1)
            .filter((_, offset) => samples.every((row) => row[offset + 1] >= 0))
            .map((name) => [name, distribution(samples.map((row) => row[columns.indexOf(name)]))]),
    );
    const ticksIndex = columns.indexOf("ticks"),
        updateIndex = columns.indexOf("update"),
        droppedIndex = columns.indexOf("dropped");
    const ticks =
        ticksIndex < 0 ? undefined : samples.reduce((sum, row) => sum + row[ticksIndex], 0);
    const before = input.samples.filter((row) => row[0] < begin).at(-1);
    return {
        frames: samples.length,
        metrics,
        ticks,
        updateMsPerTick:
            ticks && updateIndex >= 0
                ? samples.reduce((sum, row) => sum + row[updateIndex], 0) / ticks
                : null,
        droppedTicks:
            droppedIndex < 0
                ? undefined
                : samples.at(-1)![droppedIndex] - (before?.[droppedIndex] ?? 0),
        fps: metrics.cadence ? 1000 / metrics.cadence.mean : null,
        // Sort is nested in backend/prepare; never add it again to CPU totals.
    };
}
