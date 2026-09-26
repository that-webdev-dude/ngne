import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Run } from "../../core/run.js";
import { readJson } from "../../evidence/run-results.mjs";

export function measurement() {
    return readJson(
        resolve("tooling/tests/fixtures/legacy/benchmark-consolidated/churn/result.json"),
    );
}
export function evidenceFixture() {
    const base = resolve(".test-output/benchmark-evidence");
    mkdirSync(base, { recursive: true });
    const run = new Run(
        process.cwd(),
        "benchmarks",
        join(mkdtempSync(join(base, "fixture-")), "run"),
    );
    run.manifest.provenance = { revision: "fixture", changes: "" };
    run.manifest.policy = {
        parameters: { workload: "churn", diagnostics: false },
        hardware: { cpu: ["fixture"] },
        retention: { mode: "full" },
    };
    return run;
}
export async function measured(run: Run) {
    await run.stage("churn", async () => {
        run.record("churn", "measurements", {
            target: "internal-source-microbenchmark",
            raw: measurement(),
        });
        mkdirSync(join(run.evidence, "stages/churn/diagnostics"));
        writeFileSync(
            join(run.evidence, "stages/churn/diagnostics/profile.json"),
            '{"diagnostic":true}',
        );
        mkdirSync(join(run.evidence, "stages/churn/logs"));
        writeFileSync(join(run.evidence, "stages/churn/logs/stderr.log"), "diagnostic log");
    });
    run.manifest.preparation = "prepared";
}
