import { readFileSync } from "node:fs";
import { join } from "node:path";
const [a, b] = process.argv.slice(2);
if (!a || !b) throw Error("Provide two run directories");
const read = (root, name) => JSON.parse(readFileSync(join(root, name + ".json")));
const signature = (root) => {
    const m = read(root, "manifest"),
        runs = read(root, "runs");
    return {
        policy: m.policy,
        os: m.os,
        package: m.package,
        installed: m.installed,
        build: m.build,
        source: m.source,
        harness: m.harness,
        fixtures: read(root, "fixtures"),
        environment: runs.map((r) => ({
            workload: r.workload,
            environment: r.environment,
            visibility: r.visibilityChanges,
        })),
    };
};
const accepted = (root) => read(root, "result").status === "passed";
if (!accepted(a) || !accepted(b) || JSON.stringify(signature(a)) !== JSON.stringify(signature(b))) {
    console.log(
        "CHECK COMPARABILITY: acceptance status, workload, artifact or environment differs.",
    );
    process.exitCode = 2;
} else
    console.log(
        JSON.stringify(
            {
                comparable: true,
                baseline: read(a, "runs").map((r) => r.metrics),
                candidate: read(b, "runs").map((r) => r.metrics),
            },
            null,
            2,
        ),
    );
