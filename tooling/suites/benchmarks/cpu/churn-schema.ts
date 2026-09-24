// Schema churn workload: 10,000 live entities, 1,000 replacements per batch.
// A timed batch includes authoring, despawn/spawn queueing, and World.commit().
// Workload, warmup, sampling and allocation/GC modes are fixed across runs.
// See benchmarks/README.md for fresh-process commands and comparison rules.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { cpus } from "node:os";
import { performance, PerformanceObserver } from "node:perf_hooks";

import { World } from "../../../../src/ecs.js";
import { component, f64 } from "../../../../src/index.js";

// BEGIN DEFINITIONS
const API = "schema";
const Position = component("churn-position", { x: f64(), y: f64() });
const Velocity = component("churn-velocity", { x: f64(), y: f64() });
const Lifetime = component("churn-lifetime", { ticks: f64() });
// END DEFINITIONS

const LIVE = 10_000,
    PER_COMMIT = 1_000,
    WARMUP_COMMITS = 100,
    SAMPLE_COMMITS = 1_000,
    RETAINED_EVERY = 100,
    SAMPLING_INTERVAL_BYTES = 32_768;
const mode = process.argv[2];
const out = argument("--out");
const profilePath = argument("--profile");
if (mode !== "timed" && mode !== "alloc" && mode !== "gc")
    throw new Error("Mode must be timed, alloc or gc");
if (!out) throw new Error("--out is required");
const forceGc = (globalThis as { gc?: () => void }).gc;
if (mode === "alloc" && (!forceGc || !profilePath))
    throw new Error("alloc mode needs --expose-gc and --profile");

const gcEntries: { startTime: number; duration: number; kind: number }[] = [];
const observer =
    mode === "gc"
        ? new PerformanceObserver((list) => {
              for (const entry of list.getEntries())
                  gcEntries.push({
                      startTime: entry.startTime,
                      duration: entry.duration,
                      kind:
                          ("detail" in entry
                              ? (entry.detail as { kind?: number } | undefined)?.kind
                              : undefined) ?? -1,
                  });
          })
        : undefined;
observer?.observe({ entryTypes: ["gc"] });

const world = new World();
const live: ReturnType<typeof world.spawn>[] = new Array(LIVE);
let head = 0,
    serial = 0;
for (let k = 0; k < LIVE; k++) live[k] = spawnOne();
world.commit();
if (world.size !== LIVE) throw new Error(`Setup live count ${world.size}, expected ${LIVE}`);
for (let c = 0; c < WARMUP_COMMITS; c++) churnBatch();

const batchMs: number[] = [];
const retainedBytes: { afterCommit: number; heapUsed: number }[] = [];
let session: Session | undefined;
if (mode === "alloc") {
    forceGc!();
    retainedBytes.push({ afterCommit: 0, heapUsed: process.memoryUsage().heapUsed });
    session = new Session();
    session.connect();
    await session.post("HeapProfiler.enable");
    await session.post("HeapProfiler.startSampling", {
        samplingInterval: SAMPLING_INTERVAL_BYTES,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
    });
}
const windowStart = performance.now();
for (let c = 1; c <= SAMPLE_COMMITS; c++) {
    const start = performance.now();
    churnBatch();
    batchMs.push(performance.now() - start);
    if (mode === "alloc" && c % RETAINED_EVERY === 0) {
        forceGc!();
        retainedBytes.push({ afterCommit: c, heapUsed: process.memoryUsage().heapUsed });
    }
}
const windowEnd = performance.now();
if (world.size !== LIVE) throw new Error(`Final live count ${world.size}, expected ${LIVE}`);

let allocation: unknown = null;
if (session) {
    const { profile } = await session.post("HeapProfiler.stopSampling");
    session.disconnect();
    const text = JSON.stringify(profile);
    writeFileSync(profilePath!, text);
    const sites = new Map<string, number>();
    let sampledBytes = 0;
    const visit = (node: typeof profile.head) => {
        if (node.selfSize) {
            sampledBytes += node.selfSize;
            const f = node.callFrame;
            const key = `${f.functionName || "(anonymous)"} ${f.url.replace(/^.*\/(src|node_modules)\//, "$1/")}:${f.lineNumber + 1}`;
            sites.set(key, (sites.get(key) ?? 0) + node.selfSize);
        }
        node.children.forEach(visit);
    };
    visit(profile.head);
    const commitSeconds = batchMs.reduce((sum, v) => sum + v, 0) / 1000;
    allocation = {
        samplingIntervalBytes: SAMPLING_INTERVAL_BYTES,
        profilePath,
        profileBytes: text.length,
        sampledBytes,
        sampledBytesPerBatch: sampledBytes / SAMPLE_COMMITS,
        sampledBytesPerBatchSecond: sampledBytes / commitSeconds,
        topSites: [...sites.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([site, bytes]) => ({ site, bytes })),
    };
}
let gc: unknown = null;
if (observer) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    observer.disconnect();
    const inWindow = gcEntries
        .map((entry, index) => ({ ...entry, index }))
        .filter((entry) => entry.startTime >= windowStart && entry.startTime < windowEnd);
    gc = {
        source: "PerformanceObserver gc entries for window selection; pauses from --trace-gc via churn-gc-parse.mjs",
        totalObservedGcs: gcEntries.length,
        windowStartMs: windowStart,
        windowEndMs: windowEnd,
        entries: gcEntries,
        windowFirstIndex: inWindow[0]?.index ?? null,
        windowLastIndex: inWindow.at(-1)?.index ?? null,
        observedCount: inWindow.length,
        observedDurationMs: inWindow.reduce((sum, e) => sum + e.duration, 0),
    };
}
writeFileSync(
    out,
    JSON.stringify(
        {
            harness: `churn-${API}`,
            api: API,
            mode,
            revision: revision(),
            sourceHashes: Object.fromEntries(
                [
                    "../../../../src/ecs.ts",
                    "../../../../package-lock.json",
                    "./churn-schema.ts",
                ].map((path) => [
                    path,
                    createHash("sha256")
                        .update(readFileSync(new URL(path, import.meta.url)))
                        .digest("hex"),
                ]),
            ),
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cpu: cpus()[0]?.model.trim(),
            timingBoundary:
                "One batch: 1,000 despawns and spawns including component authoring, then World.commit()",
            parameters: { LIVE, PER_COMMIT, WARMUP_COMMITS, SAMPLE_COMMITS, RETAINED_EVERY },
            batchMs: mode === "timed" ? summarize(batchMs) : null,
            rawBatchMs: mode === "timed" ? batchMs : null,
            windowMs: windowEnd - windowStart,
            allocation,
            retainedHeapBytes: mode === "alloc" ? retainedBytes : null,
            gc,
        },
        null,
        2,
    ),
);

function spawnOne() {
    const i = serial++;
    const position = Position.of({ x: i, y: i * 2 });
    const velocity = Velocity.of({ x: i % 7, y: i % 11 });
    return i % 2 === 0
        ? world.spawn(position, velocity)
        : world.spawn(position, velocity, Lifetime.of({ ticks: i % 60 }));
}
function churnBatch() {
    for (let k = 0; k < PER_COMMIT; k++) {
        world.despawn(live[head]);
        live[head] = spawnOne();
        head = (head + 1) % LIVE;
    }
    world.commit();
}
function summarize(values: readonly number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (fraction: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
    return {
        samples: sorted.length,
        min: sorted[0],
        p50: at(0.5),
        p90: at(0.9),
        p95: at(0.95),
        p99: at(0.99),
        max: sorted[sorted.length - 1],
        mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    };
}
function argument(name: string) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}
function revision() {
    if (existsSync("EXPORT_REVISION"))
        return `export ${readFileSync("EXPORT_REVISION", "utf8").trim()}`;
    try {
        return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
        return "unknown";
    }
}
