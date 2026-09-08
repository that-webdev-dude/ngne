import { World } from "../src/ecs.js";
import { performance } from "node:perf_hooks";
import { component, Game, Frame } from "../src/index.js";
import { arena, type Progress, type ProgressCommand } from "../demo/game.js";
const p = component("position", () => ({ x: 0, y: 0 })),
    v = component("velocity", () => ({ x: 1, y: 2 }));
const world = new World(),
    q = world.query(p, v);
for (let i = 0; i < 20000; i++) world.spawn(p.of(), v.of());
world.commit();
for (let i = 0; i < 100; i++)
    q.each((_, p, v) => {
        p.x += v.x;
        p.y += v.y;
    });
const samples: number[] = [];
for (let i = 0; i < 300; i++) {
    const start = performance.now();
    q.each((_, p, v) => {
        p.x += v.x;
        p.y += v.y;
    });
    samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const g = new Game<Progress, ProgressCommand>({
    seed: "bench",
    state: { best: 0, runs: 0, victories: 0, lastScore: 0 },
    transition: (s) => s,
});
await g.start(await g.prepare(arena({ stress: true }), { key: "chaos" }));
const frame = new Frame();
const full: number[] = [];
let peak = 0;
for (let i = 0; i < 900; i++) {
    const start = performance.now();
    g.tick();
    frame.reset();
    g.render(frame, 0.5);
    frame.sort();
    const time = performance.now() - start;
    if (i > 100) full.push(time);
    peak = Math.max(peak, frame.count);
}
full.sort((a, b) => a - b);
console.log(
    JSON.stringify(
        {
            environment: {
                node: process.version,
                platform: process.platform,
                arch: process.arch,
            },
            ecs: {
                entities: world.size,
                medianMs: samples[Math.floor(samples.length * 0.5)],
                p95Ms: samples[Math.floor(samples.length * 0.95)],
            },
            chaos: {
                ticks: 900,
                peakSprites: peak,
                peakEntitySlots: g.scenes[0].entityCapacity,
                medianSimulationAndPreparationMs: full[Math.floor(full.length * 0.5)],
                p95SimulationAndPreparationMs: full[Math.floor(full.length * 0.95)],
            },
            note: "CPU only. Excludes GPU submission, browser display, and input polling.",
        },
        null,
        2,
    ),
);
g.dispose();
world.dispose();
