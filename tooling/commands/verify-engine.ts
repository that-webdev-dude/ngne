import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";
import { Run } from "../core/run.js";
import { command, npmPath } from "../core/process.js";

export async function verifyEngine(repository: string): Promise<Run> {
    const run = new Run(repository, "verification");
    const manifest = join(run.root, "preparation/evidence/manifest.json");
    const stages: [string, string[]][] = [
        ["format", ["run", "format:check"]],
        ["tests", ["test"]],
        ["tooling-types", ["run", "typecheck:tooling"]],
        ["types", ["run", "typecheck"]],
        ["build", ["run", "build"]],
        ["browser-build", ["run", "build:browser"]],
        ["prepare", ["run", "prepare:package", "--", "--output", join(run.root, "preparation")]],
        ["prepared", ["run", "check:prepared", "--", "--manifest", manifest]],
        ["transport", ["run", "check:browser-transport"]],
        ["installed", ["run", "verify:installed", "--", "--manifest", manifest]],
        ["browser", ["run", "test:browser"]],
    ];
    run.manifest.policy = {
        stages: stages.map(([id]) => id),
        preparationManifest: relative(run.root, manifest).replaceAll("\\", "/"),
        benchmarks: false,
        compatibility: false,
    };
    const previous = process.env.NGNE_BROWSER_ARTIFACT_DIR;
    // ponytail: reuse the browser harness environment contract; no second browser runner.
    process.env.NGNE_BROWSER_ARTIFACT_DIR = relative(repository, join(run.evidence, "browser"));
    try {
        await run.execute(async () => {
            for (const [id, args] of stages) {
                console.log(`Verification: ${id} (${run.evidence})`);
                await run.stage(id, async () => {
                    await command(run, id, process.execPath, [npmPath(), ...args], repository);
                });
            }
            run.manifest.preparation = "prepared";
        });
    } finally {
        if (previous === undefined) delete process.env.NGNE_BROWSER_ARTIFACT_DIR;
        else process.env.NGNE_BROWSER_ARTIFACT_DIR = previous;
    }
    return run;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length !== 2) throw Error("Usage: npm run verify:engine");
        const run = await verifyEngine(process.cwd());
        console.log(`Verification evidence: ${run.evidence}`);
        if (!run.result.accepted) throw Error(JSON.stringify(run.result.failures));
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
