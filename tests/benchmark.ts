import { execSync } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";

import { World, type SchemaComponentView } from "../src/ecs.js";
import { component, f64, Game, Frame } from "../src/index.js";
import { arena, type Progress, type ProgressCommand } from "../demo/game.js";
const ECS_ENTITIES = 20000,
    ECS_WARMUP = 100,
    ECS_SAMPLES = 300,
    CHAOS_SEED = "bench",
    CHAOS_TICKS = 900,
    CHAOS_WARMUP = 101,
    GRID_CELLS = 260,
    GRID_TARGETS = 256,
    GRID_PROBES = 512,
    GRID_BATCHES = 64,
    GRID_WARMUP = 100,
    GRID_SAMPLES = 300,
    TICK_BUDGET_MS = 1000 / 60;
const p = component("position", { x: f64(), y: f64() }),
    v = component("velocity", { x: f64(1), y: f64(2) });
const world = new World(),
    q = world.query(p, v);
for (let i = 0; i < ECS_ENTITIES; i++) world.spawn(p.of(), v.of());
world.commit();
if (world.size !== ECS_ENTITIES) throw new Error("ECS benchmark entity count mismatch");
for (let i = 0; i < ECS_WARMUP; i++)
    q.eachChunk((chunk) => {
        const position = chunk.views.position;
        const velocity = chunk.views.velocity;
        for (let row = 0; row < chunk.count; row++) {
            position.x[row] += velocity.x[row];
            position.y[row] += velocity.y[row];
        }
    });
const samples: number[] = [];
for (let i = 0; i < ECS_SAMPLES; i++) {
    const start = performance.now();
    q.eachChunk((chunk) => {
        const position = chunk.views.position;
        const velocity = chunk.views.velocity;
        for (let row = 0; row < chunk.count; row++) {
            position.x[row] += velocity.x[row];
            position.y[row] += velocity.y[row];
        }
    });
    samples.push(performance.now() - start);
}
const g = new Game<Progress, ProgressCommand>({
    seed: CHAOS_SEED,
    state: { best: 0, runs: 0, victories: 0, lastScore: 0 },
    transition: (s) => s,
});
await g.start(await g.prepare(arena({ stress: true }), { key: "chaos" }));
const frame = new Frame();
const full: number[] = [];
let peak = 0;
for (let i = 0; i < CHAOS_TICKS; i++) {
    const start = performance.now();
    g.tick();
    frame.reset();
    g.render(frame, 0.5);
    frame.sort();
    const time = performance.now() - start;
    if (i >= CHAOS_WARMUP) full.push(time);
    peak = Math.max(peak, frame.count);
}
const grid = runCollisionGridBenchmark();
const epoch = runEpochTraversalBenchmark();
console.log(
    JSON.stringify(
        {
            revision: revision(),
            environment: {
                node: process.version,
                platform: process.platform,
                arch: process.arch,
                cpu: cpus()[0]?.model.trim(),
                logicalCores: cpus().length,
                memoryGiB: Math.round(totalmem() / 2 ** 30),
            },
            ecs: {
                entities: world.size,
                warmupIterations: ECS_WARMUP,
                sampledIterations: ECS_SAMPLES,
                ms: summarize(samples),
            },
            chaos: {
                seed: CHAOS_SEED,
                ticks: CHAOS_TICKS,
                warmupTicks: CHAOS_WARMUP,
                sampledTicks: full.length,
                peakSprites: peak,
                peakEntitySlots: g.scenes[0].entityCapacity,
                simulationAndPreparationMs: summarize(full),
                tickBudgetMs: TICK_BUDGET_MS,
                ticksOverBudget: full.filter((time) => time > TICK_BUDGET_MS).length,
            },
            collisionGrid: grid.result,
            epochTraversal: epoch,
            note: "CPU only. Excludes GPU submission, browser display, and input polling. Dropped ticks are a browser host-loop measure; ticksOverBudget counts sampled ticks whose CPU time exceeded one 60 Hz step.",
        },
        null,
        2,
    ),
);
g.dispose();
world.dispose();
grid.dispose();

function runCollisionGridBenchmark() {
    const GridPosition = component("benchmark-grid-position", { x: f64(), y: f64() });
    type GridPositionView = SchemaComponentView<typeof GridPosition.fields>;
    interface SchemaEntry {
        readonly position: GridPositionView;
        readonly row: number;
    }
    const schemaWorld = new World();
    for (let target = 0; target < GRID_TARGETS; target++)
        schemaWorld.spawn(GridPosition.of({ x: target, y: target * 2 }));
    schemaWorld.commit();
    const schema = Array.from({ length: GRID_CELLS }, () => [] as SchemaEntry[]);
    const schemaPositions = schemaWorld.query(GridPosition);

    const probeCells = Array.from({ length: GRID_PROBES }, (_, probe) => probe % GRID_CELLS);
    const sample = (probe: () => number): { samples: number[]; checks: number } => {
        for (let warmup = 0; warmup < GRID_WARMUP; warmup++) probe();
        const samples: number[] = [];
        let checks = 0;
        for (let index = 0; index < GRID_SAMPLES; index++) {
            const start = performance.now();
            checks = probe();
            samples.push(performance.now() - start);
        }
        return { samples, checks };
    };
    const schemaSample = sample(() => {
        let checks = 0;
        let checksum = 0;
        for (let batch = 0; batch < GRID_BATCHES; batch++) {
            for (const cell of schema) cell.length = 0;
            schemaPositions.eachChunk((chunk) => {
                const position = chunk.views["benchmark-grid-position"];
                for (let row = 0; row < chunk.count; row++)
                    schema[position.x[row]].push({ position, row });
            });
            for (const cell of probeCells)
                for (const entry of schema[cell]) {
                    checksum += entry.position.x[entry.row] + entry.position.y[entry.row];
                    checks++;
                }
        }
        if (checksum === 0) throw new Error("Schema collision-grid benchmark was not evaluated");
        return checks;
    });
    const timerResolutionMs = measureTimerResolution();
    const schemaMs = summarize(schemaSample.samples);
    const valid = schemaMs.p50 >= timerResolutionMs * 100;
    return {
        result: {
            cells: GRID_CELLS,
            targets: GRID_TARGETS,
            probes: GRID_PROBES,
            batchesPerSample: GRID_BATCHES,
            warmupIterations: GRID_WARMUP,
            sampledIterations: GRID_SAMPLES,
            candidateChecksPerSample: schemaSample.checks,
            timerResolutionMs,
            validityThresholdMs: timerResolutionMs * 100,
            valid,
            schemaViewRow: {
                ms: schemaMs,
                nsPerCandidateCheck: summarize(
                    schemaSample.samples.map((time) => (time * 1_000_000) / schemaSample.checks),
                ),
            },
        },
        dispose: () => schemaWorld.dispose(),
    };
}

/**
 * Pairs the first typed traversal after a commit, which rebuilds borrowed chunk descriptors
 * for the new epoch, with an identical second traversal in the same epoch. The preceding commit
 * changes no membership but still advances the epoch; it is timed separately from both
 * traversals. Runs after the other sections so it cannot change their warm state.
 */
function runEpochTraversalBenchmark() {
    const traverse = () =>
        q.eachChunk((chunk) => {
            const position = chunk.views.position;
            const velocity = chunk.views.velocity;
            for (let row = 0; row < chunk.count; row++) {
                position.x[row] += velocity.x[row];
                position.y[row] += velocity.y[row];
            }
        });
    const sample = (record?: { commit: number[]; first: number[]; second: number[] }) => {
        const epochBefore = world.commitEpoch;
        let start = performance.now();
        world.commit();
        const commit = performance.now() - start;
        if (world.commitEpoch === epochBefore)
            throw new Error("No-op commit did not advance the query borrow epoch");
        start = performance.now();
        traverse();
        const first = performance.now() - start;
        start = performance.now();
        traverse();
        const second = performance.now() - start;
        record?.commit.push(commit);
        record?.first.push(first);
        record?.second.push(second);
    };
    for (let i = 0; i < ECS_WARMUP; i++) sample();
    const samples = { commit: [] as number[], first: [] as number[], second: [] as number[] };
    for (let i = 0; i < ECS_SAMPLES; i++) sample(samples);
    let chunks = 0;
    q.eachChunk(() => chunks++);
    return {
        entities: world.size,
        chunks,
        warmupIterations: ECS_WARMUP,
        sampledIterations: ECS_SAMPLES,
        noOpCommitMs: summarize(samples.commit),
        firstTraversalAfterCommitMs: summarize(samples.first),
        secondTraversalSameEpochMs: summarize(samples.second),
        pairedDeltaMs: summarize(samples.first.map((first, i) => first - samples.second[i])),
    };
}

function measureTimerResolution(): number {
    let minimum = Infinity;
    let previous = performance.now();
    for (let sample = 0; sample < 10000; sample++) {
        const current = performance.now();
        const delta = current - previous;
        if (delta > 0) minimum = Math.min(minimum, delta);
        previous = current;
    }
    if (!Number.isFinite(minimum)) throw new Error("Unable to measure timer resolution");
    return minimum;
}
function summarize(values: readonly number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (fraction: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
    return {
        min: sorted[0],
        p50: at(0.5),
        p90: at(0.9),
        p95: at(0.95),
        p99: at(0.99),
        max: sorted[sorted.length - 1],
        mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    };
}
function revision() {
    try {
        return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
        return "unknown";
    }
}
