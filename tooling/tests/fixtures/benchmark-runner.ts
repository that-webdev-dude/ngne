import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

export function benchmarkFixture() {
    const parent = resolve(".test-output/benchmark-runner");
    mkdirSync(parent, { recursive: true });
    const root = mkdtempSync(join(parent, "fixture-"));
    for (const p of [
        "src",
        "demo",
        "examples",
        "benchmarks/browser",
        "tooling/core",
        "tooling/evidence",
        "tooling/suites/benchmarks/cpu",
        "tooling/commands",
        "tests/tooling",
    ])
        mkdirSync(join(root, p), { recursive: true });
    for (const p of [
        "index.html",
        "package-lock.json",
        "vite.config.ts",
        "tooling/commands/benchmark-all.ts",
    ])
        writeFileSync(join(root, p), "fixture\n");
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    symlinkSync(
        resolve("node_modules"),
        join(root, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
    );
    copyFileSync(
        resolve("tooling/evidence/run-results.mjs"),
        join(root, "tooling/evidence/run-results.mjs"),
    );
    return root;
}
