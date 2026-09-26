import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Run } from "../../core/run.js";
import { benchmarkMeasurements } from "../../evidence/benchmark-results.js";
import { contained, identities } from "../../evidence/identity.js";

/** Called by the run owner after process cleanup, before the final artifact inventory. */
export function compactRun(run: Run, removeFile = unlinkSync): void {
    const root = resolve(run.evidence);
    for (let p = root; ; p = dirname(p)) {
        if (lstatSync(p).isSymbolicLink()) throw Error(`Compaction refuses linked ancestor: ${p}`);
        if (dirname(p) === p) break;
    }
    if (root !== join(resolve(run.root), "evidence")) throw Error("Compaction target mismatch");
    if (
        run.manifest.preparation !== "prepared" ||
        run.result.failures.length ||
        !run.result.stages.length ||
        run.result.stages.some((s) => s.execution !== "completed" || s.correctness !== "passed") ||
        run.result.cleanupRecords.some((s) => s.status !== "passed")
    )
        throw Error("Failed or incomplete run: diagnostics retained");
    benchmarkMeasurements(root, run.manifest, run.result);
    identities(root); // Reject links anywhere before deleting anything.
    const files: string[] = [],
        directories: string[] = [];
    const visit = (path: string) => {
        for (const item of readdirSync(path, { withFileTypes: true })) {
            const child = join(path, item.name);
            if (item.isDirectory()) visit(child);
            else files.push(relative(root, child).replaceAll("\\", "/"));
        }
        directories.push(relative(root, path).replaceAll("\\", "/"));
    };
    for (const stage of run.result.stages) {
        const path = `stages/${stage.id}/diagnostics`;
        if (existsSync(join(root, path))) visit(contained(root, path));
    }
    const removedArtifacts: string[] = [];
    const retention = { mode: "compacting", compactRequested: true, removedArtifacts };
    run.manifest.policy.retention = retention;
    try {
        for (const file of files) {
            removeFile(contained(root, file));
            removedArtifacts.push(file);
        }
        for (const directory of directories) rmdirSync(contained(root, directory));
        retention.mode = "compact";
    } catch (error) {
        retention.mode = "failed";
        throw error;
    }
}
