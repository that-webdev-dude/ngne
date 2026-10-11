import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { Session } from "node:inspector/promises";
import { World, component, f32, u8 } from "../../../../src/ecs.js";
import { Run } from "../../../core/run.js";
import { identities } from "../../../evidence/identity.js";

const run = new Run(process.cwd(), "ecs-density");
run.manifest.provenance = {
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    changes: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
};
run.manifest.harness = {
    ...Object.fromEntries(
        Object.entries(identities("src")).map(([key, value]) => [`src/${key}`, value]),
    ),
    ...Object.fromEntries(
        Object.entries(identities("tooling/suites/benchmarks/cpu"))
            .filter(([key]) => key.endsWith(".ts"))
            .map(([key, value]) => [`cpu/${key}`, value]),
    ),
};
run.manifest.policy = {
    cpu: cpus()[0]?.model,
    warmup: 100,
    samples: 300,
    profile: process.env.NGNE_DIAGNOSTICS === "1",
    note: "First minus same-epoch traversal is an overhead estimate, not isolated descriptor timing. Counts are expected rebuilds derived from visited chunks, not allocations in bytes.",
};
console.log(run.root);
const result = await run.execute(async () => {
    run.manifest.preparation = "prepared";
    for (const count of [8000, 24000, 64000, 128000]) {
        for (const arithmetic of [false, true]) {
            await run.stage(`n${count}-${arithmetic ? "arithmetic" : "traversal"}`, async () => {
                const State = component("state", {
                    x: f32(),
                    y: f32(),
                    vx: f32(1),
                    vy: f32(2),
                    age: f32(),
                    weight: f32(1),
                    kind: u8(),
                });
                const world = new World();
                for (let i = 0; i < count; i++) world.spawn(State.of({ x: i, y: i * 2 }));
                world.commit();
                const query = world.query(State);
                const x = new Float32Array(count),
                    y = new Float32Array(count);
                const vx = new Float32Array(count).fill(1),
                    vy = new Float32Array(count).fill(2);
                for (let i = 0; i < count; i++) {
                    x[i] = i;
                    y[i] = i * 2;
                }
                let chunks = 0,
                    rows = 0;
                const traverse = () => {
                    chunks = 0;
                    rows = 0;
                    query.eachChunk((chunk) => {
                        const state = chunk.views.state,
                            live = chunk.count;
                        chunks++;
                        rows += live;
                        if (arithmetic)
                            for (let i = 0; i < live; i++) {
                                state.x[i] += state.vx[i];
                                state.y[i] += state.vy[i];
                            }
                    });
                    if (rows !== count) throw Error("Row count mismatch");
                };
                const plain = () => {
                    if (arithmetic)
                        for (let i = 0; i < count; i++) {
                            x[i] += vx[i];
                            y[i] += vy[i];
                        }
                };
                const samples: number[][] = [];
                const measure = (record: boolean) => {
                    const start = performance.now();
                    world.commit();
                    const commit = performance.now();
                    traverse();
                    const first = performance.now();
                    traverse();
                    const second = performance.now();
                    plain();
                    plain();
                    const end = performance.now();
                    if (record)
                        samples.push([
                            commit - start,
                            first - commit,
                            second - first,
                            (end - second) / 2,
                        ]);
                };
                try {
                    for (let i = 0; i < 100; i++) measure(false);
                    let profile: unknown;
                    const session = new Session();
                    try {
                        if (process.env.NGNE_DIAGNOSTICS === "1") {
                            session.connect();
                            await session.post("HeapProfiler.startSampling", {
                                samplingInterval: 4096,
                                includeObjectsCollectedByMajorGC: true,
                                includeObjectsCollectedByMinorGC: true,
                            });
                        }
                        for (let i = 0; i < 300; i++) measure(true);
                        if (process.env.NGNE_DIAGNOSTICS === "1")
                            profile = await session.post("HeapProfiler.stopSampling");
                    } finally {
                        session.disconnect();
                    }
                    let index = 0;
                    query.eachChunk((chunk) => {
                        const state = chunk.views.state;
                        for (let i = 0; i < chunk.count; i++, index++)
                            if (state.x[i] !== x[index] || state.y[i] !== y[index])
                                throw Error("Plain/ECS arithmetic mismatch");
                    });
                    run.record(
                        `n${count}-${arithmetic ? "arithmetic" : "traversal"}`,
                        "measurements",
                        {
                            count,
                            arithmetic,
                            chunks,
                            expectedDescriptorsPerFirstTraversal: chunks,
                            expectedDescriptorsPerSecondTraversal: 0,
                            columns: ["commit", "first", "sameEpoch", "plain"],
                            samples,
                            profile,
                        },
                    );
                } finally {
                    world.dispose();
                }
            });
        }
    }
});
console.log(
    JSON.stringify({
        evidence: run.evidence,
        accepted: result.accepted,
        failures: result.failures,
    }),
);
if (!result.accepted) process.exitCode = 1;
