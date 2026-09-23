// Synthetic protocol peer. It hashes bytes; it does not install or validate an engine.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arch, platform, release } from "node:os";
import { atomic } from "../../../core/run.js";
import { hash, identities } from "../../../evidence/identity.js";
import { header, sha, type Result } from "../../../evidence/schema.js";
import { type ConsumerManifest } from "../../../evidence/consumer-contract-v1.js";

export const consumer = {
    revision: "synthetic-v1",
    source: { "stub.ts": hash("synthetic source") },
    lock: { "package-lock.json": hash("synthetic lock") },
};
export function inventory(evidence: string, runId: string): void {
    atomic(join(evidence, "artifacts.json"), {
        ...header("artifacts", runId),
        files: Object.entries(identities(evidence))
            .filter(([p]) => p !== "artifacts.json")
            .map(([path, sha256]) => ({
                path,
                sha256,
                bytes: readFileSync(join(evidence, path)).length,
            })),
    });
}
export function stub(args: string[], fail = false): number {
    let tarball: string, output: string, runId: string, expected: string;
    try {
        const keys = [
            "--contract-version",
            "--engine-tarball",
            "--engine-sha256",
            "--output",
            "--run-id",
        ];
        const flags = new Map<string, string>();
        if (args.length !== 10) throw Error("Expected exactly five options");
        for (let i = 0; i < args.length; i += 2) {
            if (!keys.includes(args[i]) || flags.has(args[i])) throw Error("Invalid option");
            flags.set(args[i], args[i + 1]);
        }
        if (flags.get("--contract-version") !== "1") throw Error("Unsupported contract");
        tarball = flags.get("--engine-tarball")!;
        output = flags.get("--output")!;
        runId = flags.get("--run-id")!;
        expected = sha(flags.get("--engine-sha256"));
        if (!runId.trim() || !isAbsolute(tarball) || !isAbsolute(output))
            throw Error("Invalid paths/run ID");
        if (!/^[^/\\:]+\.tgz$/.test(basename(tarball))) throw Error("Invalid tarball filename");
        if (hash(readFileSync(tarball)) !== expected) throw Error("Package hash mismatch");
        mkdirSync(dirname(output), { recursive: true });
        mkdirSync(output);
    } catch {
        return 2;
    }
    try {
        const evidence = join(output, "evidence");
        mkdirSync(evidence);
        const result: Result = {
            ...header("result", runId),
            execution: "running",
            correctness: "not evaluated",
            budgets: "not evaluated",
            cleanup: "pending",
            evidence: "partial",
            stages: [],
            failures: [],
            cleanupRecords: [],
            accepted: false,
        };
        atomic(join(evidence, "result.json"), result);
        const manifest: ConsumerManifest = {
            ...header("consumer-manifest", runId),
            contractVersion: 1,
            package: {
                filename: basename(tarball),
                path: `package/${basename(tarball)}`,
                sha256: expected,
            },
            installed: { "synthetic.txt": hash("synthetic installation") },
            consumer,
            environment: {
                node: process.version,
                platform: platform(),
                release: release(),
                arch: arch(),
            },
        };
        atomic(join(evidence, "manifest.json"), manifest);
        mkdirSync(join(evidence, "package"));
        copyFileSync(tarball, join(evidence, manifest.package.path));
        result.execution = fail ? "failed" : "completed";
        result.correctness = fail ? "failed" : "passed";
        result.cleanup = "passed";
        result.evidence = "complete";
        result.accepted = !fail;
        result.stages = [
            {
                id: "synthetic-contract",
                required: true,
                execution: result.execution,
                correctness: result.correctness,
                budgets: "not evaluated",
                cleanup: "passed",
                evidence: "complete",
            },
        ];
        if (fail)
            result.failures.push({
                kind: "scenario",
                message: "Synthetic consumer assertion failure",
            });
        atomic(join(evidence, "result.json"), result);
        writeFileSync(
            join(evidence, "report.md"),
            "Synthetic contract evidence only; no engine installation or browser execution.\n",
        );
        inventory(evidence, runId);
        return fail ? 1 : 0;
    } catch {
        return 1;
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    process.exitCode = stub(process.argv.slice(2));
