import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { content } from "../suites/benchmarks/content/run.js";
import { inflateSync } from "node:zlib";
import { imageBytes } from "../suites/benchmarks/content/fixtures.js";
import {
    assertMounted,
    assertDisposed,
    readSample,
    type Sample,
} from "../suites/benchmarks/content/accounting.js";
import { readMeasurement } from "../suites/benchmarks/content/measurement.js";

const mounted = (): Sample => ({
    assets: {
        loaded: 4,
        loading: 0,
        leased: 4,
        unleased: 0,
        estimatedBytes: 40000,
        cleanupFailures: 0,
        unknownSizes: 1,
        protectedOverBudget: true,
        claims: { external: 0, scene: 4, dependency: 0, renderer: 2 },
    },
    renderer: { sources: 2, consumers: 2, textures: 3, uploads: 0, manualReplacements: 0 },
    voices: 1,
    contexts: 1,
    bitmaps: 2,
    textures: 3,
    visibility: "visible",
    errors: [],
});
const disposed = (): Sample => ({
    ...mounted(),
    assets: {
        ...mounted().assets,
        loaded: 0,
        leased: 0,
        estimatedBytes: 0,
        claims: { external: 0, scene: 0, dependency: 0, renderer: 0 },
    },
    renderer: { sources: 0, consumers: 0, textures: 0, uploads: 0, manualReplacements: 0 },
    voices: 0,
    contexts: 0,
    bitmaps: 0,
    textures: 0,
});
function valid() {
    return {
        status: "passed",
        samplingComplete: true,
        failures: [],
        warmup: 12,
        method: "prepare-to-mounted-and-rendered-ordinary-frames-v1",
        samples: Array.from({ length: 12 }, (_, i) => ({
            index: (i + 1) % 12,
            ms: i + 1,
            heap: 100,
            observed: mounted(),
        })),
        cancellations: Array.from({ length: 3 }, (_, trial) => ({
            trial,
            before: { ...mounted(), closed: 1 },
            after: { ...mounted(), closed: 2 },
        })),
        disposed: disposed(),
        environment: {
            visibility: "visible",
            visibilityEvents: ["visible"],
            gpu: [{ isFallbackAdapter: false }],
        },
    };
}

test("generated engine images are deterministic distinct complete PNG payloads", () => {
    const images = Array.from({ length: 13 }, (_, i) => imageBytes(i));
    assert.equal(new Set(images.map((image) => image.toString("base64"))).size, 13);
    images.forEach((image, i) => {
        assert.deepEqual(image, imageBytes(i));
        assert.equal(image.readUInt32BE(16), 64);
        assert.equal(image.readUInt32BE(20), 64);
        const length = image.readUInt32BE(33),
            pixels = inflateSync(image.subarray(41, 41 + length));
        assert.equal(pixels.length, 64 * 257);
        assert.equal(pixels[4], 255);
        assert.equal(pixels[1], (i * 31) % 256);
    });
});
test("engine resource oracle rejects lost claims leaks hidden runs and diagnostics", () => {
    assertMounted(readSample(mounted()));
    assertDisposed(readSample(disposed()));
    for (const change of [
        (s: Sample) => s.assets.claims.renderer--,
        (s: Sample) => s.voices++,
        (s: Sample) => s.bitmaps++,
        (s: Sample) => s.assets.cleanupFailures++,
        (s: Sample) => s.renderer.uploads++,
        (s: Sample) => (s.visibility = "hidden"),
        (s: Sample) => s.errors.push("load failed"),
    ]) {
        const sample = mounted();
        change(sample);
        assert.throws(() => assertMounted(sample));
    }
    for (const field of ["voices", "contexts", "bitmaps", "textures"] as const) {
        const sample = disposed();
        sample[field] = 1;
        assert.throws(() => assertDisposed(sample));
    }
    assert.throws(() => readSample({ ...mounted(), voices: NaN }));
    assert.throws(() => readSample({ ...mounted(), assets: {} }));
});
test("engine measurement validation rejects truncated reordered failed and fallback results", () => {
    assert.deepEqual(readMeasurement(valid(), 12), { count: 12, p50: 6, p95: 12, max: 12 });
    const changes: ((v: ReturnType<typeof valid>) => void)[] = [
        (v) => v.samples.pop(),
        (v) => (v.samples[0].index = 7),
        (v) => (v.samples[0].ms = NaN),
        (v) => v.cancellations.pop(),
        (v) => (v.cancellations[0].after.closed = 1),
        (v) => (v.cancellations[0].after.closed = NaN),
        (v) => (v.disposed.textures = 1),
        (v) => (v.environment.gpu[0].isFallbackAdapter = true),
        (v) => (v.environment.visibility = "hidden"),
        (v) => v.environment.visibilityEvents.push("hidden"),
        (v) => (v.samplingComplete = false),
        (v) => (v.status = "failed"),
    ];
    for (const change of changes) {
        const value = valid();
        change(value);
        assert.throws(() => readMeasurement(value, 12));
    }
});

test("engine benchmark rejects missing preparation and reused output without selecting a fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "ngne-content-failure-"));
    try {
        const output = join(root, "run");
        const run = await content(process.cwd(), {
            manifest: join(root, "missing/evidence/manifest.json"),
            output,
        });
        assert.equal(run.result.accepted, false);
        assert.equal(run.result.execution, "failed");
        assert.equal(run.result.cleanup, "passed");
        assert.equal(run.result.failures[0].kind, "scenario");
        assert.equal(run.result.stages.length, 1);
        const before = readFileSync(join(run.evidence, "result.json"));
        await assert.rejects(content(process.cwd(), { output }), /EEXIST/);
        assert.deepEqual(readFileSync(join(run.evidence, "result.json")), before);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
