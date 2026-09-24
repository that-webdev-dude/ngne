import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Run } from "../core/run.js";
import { benchmarkOptions } from "../suites/benchmarks/options.js";
import {
    environmentMismatches,
    readProfile,
    readBudget,
    baselineEvidence,
} from "../suites/benchmarks/content/policy.js";
import { header } from "../evidence/schema.js";
import { readMeasurement } from "../suites/benchmarks/content/measurement.js";
import { hash } from "../evidence/identity.js";

const profile = () =>
    readProfile({
        schemaVersion: 1,
        name: "test-physical",
        expected: {
            node: "v24",
            platform: "win32",
            release: "test",
            arch: "x64",
            cpu: "test cpu",
            logicalCores: 8,
            totalMemory: 1024,
            browserProduct: "Chrome/test",
            browserRevision: "test",
            browserUserAgent: "test",
            headless: false,
            visibility: "visible",
            dpr: 1,
            viewport: [1280, 900],
            flags: ["--test"],
            gpu: {
                vendor: "test",
                architecture: "test",
                device: "",
                description: "",
                isFallbackAdapter: false,
            },
        },
    });

test("benchmark flags preserve legacy selections and reject ambiguous inputs", () => {
    const a = benchmarkOptions(
        [
            "-Workload",
            "churn",
            "-Diagnostics",
            "-Compact",
            "-WarmupSeconds",
            "0",
            "-DurationSeconds",
            "1",
            "-SkipBuild",
        ],
        process.cwd(),
    );
    assert.deepEqual(
        a,
        benchmarkOptions(
            [
                "--workload",
                "churn",
                "--diagnostics",
                "--compact",
                "--warmup-seconds",
                "0",
                "--duration-seconds",
                "1",
                "--skip-build",
            ],
            process.cwd(),
        ),
    );
    for (const args of [
        ["--workload", "x"],
        ["--duration-seconds", "0"],
        ["--warmup-seconds", "NaN"],
        ["--diagnostics", "-Diagnostics"],
        ["--base-url", "file:///x"],
        ["--workload"],
    ])
        assert.throws(() => benchmarkOptions(args, process.cwd()));
});

test("named profiles validate every required observed field, physical adapter and headed visibility", () => {
    const p = profile();
    assert.deepEqual(environmentMismatches(p, { ...p.expected }), []);
    for (const field of Object.keys(p.expected)) {
        const observed = { ...p.expected };
        delete observed[field];
        assert.ok(
            environmentMismatches(p, observed).some((m) => m.startsWith(`environment.${field}:`)),
        );
    }
    for (const changed of [
        { headless: true },
        { visibility: "hidden" },
        {
            gpu: {
                vendor: "test",
                architecture: "",
                device: "",
                description: "",
                isFallbackAdapter: true,
            },
        },
        { cpu: null },
    ])
        assert.throws(() => readProfile({ ...p, expected: { ...p.expected, ...changed } }));
});

test("measured budgets require independent complete baselines and exact derived limits", () => {
    const value = {
        ...header("benchmark-budget", "test-budget"),
        profile: profile(),
        signature: "1".repeat(64),
        method: "maximum-repetition-p95-times-1.2",
        p95Ms: 12,
        baselines: [0, 1, 2].map((i) => ({
            runId: `baseline-${i}`,
            manifestSHA256: "2".repeat(64),
            resultSHA256: "3".repeat(64),
            p95Ms: [8, 9, 10],
        })),
    };
    assert.equal(readBudget(value).p95Ms, 12);
    assert.throws(() => readBudget({ ...value, p95Ms: 13 }));
    assert.throws(() => readBudget({ ...value, baselines: value.baselines.slice(1) }));
    assert.throws(() =>
        readBudget({
            ...value,
            baselines: [value.baselines[0], value.baselines[0], value.baselines[0]],
        }),
    );
    assert.throws(() =>
        readBudget({ ...value, baselines: value.baselines.map((b) => ({ ...b, p95Ms: [8, 9] })) }),
    );
});

test("over-budget sampling completes all repetitions and cleanup with independent outcomes", async () => {
    const parent = resolve(".test-output/benchmark-policy");
    mkdirSync(parent, { recursive: true });
    const root = join(mkdtempSync(join(parent, "run-")), "output"),
        run = new Run(process.cwd(), "budget-test", root);
    const sampled: number[] = [];
    let cleaned = false;
    run.cleanup.push([
        "test resource",
        async () => {
            cleaned = true;
        },
    ]);
    await run.execute(async () => {
        await run.stage("preparation", async () => {});
        for (let i = 0; i < 3; i++)
            await run.stage(`sample-${i}`, async () => {
                sampled.push(i);
                run.record(`sample-${i}`, "measurements", { samples: [1, 2, 3] });
                run.result.stages.at(-1)!.budgets = i === 0 ? "failed" : "passed";
            });
    });
    assert.deepEqual(sampled, [0, 1, 2]);
    assert.equal(cleaned, true);
    assert.equal(run.result.execution, "completed");
    assert.equal(run.result.correctness, "passed");
    assert.equal(run.result.budgets, "failed");
    assert.equal(run.result.cleanup, "passed");
    assert.equal(run.result.evidence, "complete");
    assert.equal(run.result.accepted, false);
    assert.equal(
        JSON.parse(readFileSync(join(run.evidence, "result.json"), "utf8")).accepted,
        false,
    );
});

test("baseline loading verifies retained bytes and recomputes complete raw measurement metrics", async () => {
    const parent = resolve(".test-output/benchmark-policy");
    mkdirSync(parent, { recursive: true });
    const run = new Run(
        process.cwd(),
        "content-engine",
        join(mkdtempSync(join(parent, "baseline-")), "run"),
    );
    const p = profile();
    const packageBytes = Buffer.from("synthetic parser fixture, not an installed engine");
    mkdirSync(join(run.evidence, "package"));
    writeFileSync(join(run.evidence, "package/synthetic.tgz"), packageBytes);
    const tree = { path: "work/synthetic", files: { "index.js": hash("fixture") } };
    run.manifest.preparation = "prepared";
    run.manifest.prepared = {
        package: {
            path: "evidence/package/synthetic.tgz",
            filename: "synthetic.tgz",
            sha256: hash(packageBytes),
            files: tree.files,
        },
        installed: tree,
        workload: tree,
        dependencies: tree,
        builds: { root: tree, nested: tree },
        toolchain: { node: process.version, npm: "fixture", typescript: "fixture" },
        dependencyPolicy: "offline-lockfile-ci-no-scripts",
    };
    const mounted = {
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
    };
    const raw = {
        status: "passed",
        samplingComplete: true,
        failures: [],
        warmup: 12,
        method: "prepare-to-mounted-and-rendered-ordinary-frames-v1",
        samples: Array.from({ length: 120 }, (_, i) => ({
            index: (i + 1) % 12,
            ms: 10,
            heap: null,
            observed: mounted,
        })),
        cancellations: Array.from({ length: 3 }, (_, trial) => ({
            trial,
            before: { ...mounted, closed: 1 },
            after: { ...mounted, closed: 2 },
        })),
        disposed: {
            ...mounted,
            assets: {
                ...mounted.assets,
                loaded: 0,
                leased: 0,
                estimatedBytes: 0,
                claims: { external: 0, scene: 0, dependency: 0, renderer: 0 },
            },
            renderer: { ...mounted.renderer, sources: 0, consumers: 0, textures: 0 },
            voices: 0,
            contexts: 0,
            bitmaps: 0,
            textures: 0,
        },
        environment: {
            visibility: "visible",
            visibilityEvents: ["visible"],
            gpu: [p.expected.gpu],
        },
    };
    run.manifest.policy = {
        mode: "baseline",
        smoke: false,
        profile: p,
        budgetSignature: "1".repeat(64),
    };
    await run.execute(async () => {
        for (let i = 0; i < 3; i++)
            await run.stage(`repetition-${i}`, async () => {
                run.record(`repetition-${i}`, "measurements", {
                    raw,
                    metrics: readMeasurement(raw, 120),
                    observed: p.expected,
                    environmentMismatches: [],
                });
            });
    });
    assert.deepEqual(baselineEvidence(run.evidence).row.p95Ms, [10, 10, 10]);
    const originalInventory = readFileSync(join(run.evidence, "artifacts.json"));
    const missingPackage = JSON.parse(originalInventory.toString());
    missingPackage.files = missingPackage.files.filter(
        (file: { path: string }) => file.path !== "package/synthetic.tgz",
    );
    writeFileSync(join(run.evidence, "artifacts.json"), JSON.stringify(missingPackage));
    assert.throws(() => baselineEvidence(run.evidence), /Missing baseline inventory package/);
    writeFileSync(join(run.evidence, "artifacts.json"), originalInventory);
    const path = join(run.evidence, "stages/repetition-0/measurements.json"),
        bytes = readFileSync(path);
    writeFileSync(path, Buffer.concat([bytes, Buffer.from(" ")]));
    assert.throws(() => baselineEvidence(run.evidence), /Corrupt baseline artifact/);
    const changed = JSON.parse(bytes.toString());
    changed.raw.samples.pop();
    writeFileSync(path, JSON.stringify(changed));
    const inventoryPath = join(run.evidence, "artifacts.json"),
        inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    const artifact = inventory.files.find(
        (f: { path: string }) => f.path === "stages/repetition-0/measurements.json",
    );
    const newBytes = readFileSync(path);
    artifact.sha256 = hash(newBytes);
    artifact.bytes = newBytes.length;
    writeFileSync(inventoryPath, JSON.stringify(inventory));
    assert.throws(() => baselineEvidence(run.evidence), /Incomplete samples/);
});
