import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { baselineEvidence, readBudget, readProfile } from "../suites/benchmarks/content/policy.js";
import { header, sha } from "../evidence/schema.js";

try {
    const [output, profilePath, ...runs] = process.argv.slice(2);
    if (!output || !profilePath || runs.length < 3)
        throw Error(
            "Usage: benchmark-budget <new-budget.json> <profile.json> <evidence-dir> <evidence-dir> <evidence-dir> [...]",
        );
    const profile = readProfile(JSON.parse(readFileSync(profilePath, "utf8")));
    const evidence = runs.map(baselineEvidence),
        signature = sha(evidence[0].manifest.policy.budgetSignature);
    for (const { manifest } of evidence)
        if (
            manifest.policy.budgetSignature !== signature ||
            !isDeepStrictEqual(manifest.policy.profile, profile)
        )
            throw Error(
                "Baseline workload/harness/method/toolchain/profile drift; remeasure under matching conditions",
            );
    const budget = readBudget({
        ...header("benchmark-budget", randomUUID()),
        profile,
        signature,
        method: "maximum-repetition-p95-times-1.2",
        p95Ms: Math.max(...evidence.flatMap((e) => e.row.p95Ms)) * 1.2,
        baselines: evidence.map((e) => e.row),
    });
    writeFileSync(output, JSON.stringify(budget, null, 2) + "\n", { flag: "wx" });
    console.log(`Measured budget: ${output}`);
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
