import { execSync } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";

import { World } from "../src/ecs.js";
import { component, Game, Frame } from "../src/index.js";
import { arena, type Progress, type ProgressCommand } from "../demo/game.js";
const ECS_ENTITIES = 20000,
    ECS_WARMUP = 100,
    ECS_SAMPLES = 300,
    CHAOS_SEED = "bench",
    CHAOS_TICKS = 900,
    CHAOS_WARMUP = 101,
    TICK_BUDGET_MS = 1000 / 60;
const p = component("position", () => ({ x: 0, y: 0 })),
    v = component("velocity", () => ({ x: 1, y: 2 }));
const world = new World(),
    q = world.query(p, v);
for (let i = 0; i < ECS_ENTITIES; i++) world.spawn(p.of(), v.of());
world.commit();
for (let i = 0; i < ECS_WARMUP; i++)
    q.each((_, p, v) => {
        p.x += v.x;
        p.y += v.y;
    });
const samples: number[] = [];
for (let i = 0; i < ECS_SAMPLES; i++) {
    const start = performance.now();
    q.each((_, p, v) => {
        p.x += v.x;
        p.y += v.y;
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
            note: "CPU only. Excludes GPU submission, browser display, and input polling. Dropped ticks are a browser host-loop measure; ticksOverBudget counts sampled ticks whose CPU time exceeded one 60 Hz step.",
        },
        null,
        2,
    ),
);
g.dispose();
world.dispose();
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
