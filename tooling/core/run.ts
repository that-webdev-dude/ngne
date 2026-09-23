import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { arch, platform, release } from "node:os";
import { cleanupSteps, failureText, type CleanupStep } from "../../tests/tooling/cleanup.mjs";
import { hash, identities, safePath } from "../evidence/identity.js";
import {
    accepts,
    header,
    readManifest,
    readResult,
    type Check,
    type Manifest,
    type Outcome,
    type Result,
    type Stage,
} from "../evidence/schema.js";
import { report } from "../evidence/report.js";

export function atomic(path: string, value: unknown): void {
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
    renameSync(temporary, path);
}
const pending = (): Outcome => ({
    execution: "pending",
    correctness: "not evaluated",
    budgets: "not evaluated",
    cleanup: "pending",
    evidence: "partial",
});

/** Lifecycle extracted from content/run.mjs; independent outcomes are intentionally new. */
export class Run {
    readonly root: string;
    readonly evidence: string;
    readonly manifest: Manifest;
    readonly result: Result;
    readonly cleanup: CleanupStep[] = [];
    private finalized = false;

    constructor(repository: string, suite: string, output?: string) {
        if (!/^[a-z0-9-]+$/.test(suite)) throw Error("Invalid suite");
        const runId = `${new Date().toISOString().replaceAll(":", "-")}-${suite}-${randomUUID()}`;
        this.root = resolve(output ?? join(repository, "out/runs", runId));
        mkdirSync(dirname(this.root), { recursive: true });
        mkdirSync(this.root); // Deliberately exclusive, even for an empty supplied directory.
        this.evidence = join(this.root, "evidence");
        mkdirSync(this.evidence);
        this.manifest = {
            ...header("manifest", runId),
            suite,
            startedAt: new Date().toISOString(),
            preparation: "pending",
            provenance: null,
            environment: {
                node: process.version,
                platform: platform(),
                release: release(),
                arch: arch(),
            },
            harness: {},
            policy: {},
            prepared: null,
        };
        this.result = {
            ...header("result", runId),
            ...pending(),
            stages: [],
            failures: [],
            cleanupRecords: [],
            accepted: false,
        };
        this.persist();
    }
    persist(): void {
        readManifest(this.manifest);
        readResult(this.result);
        atomic(join(this.evidence, "manifest.json"), this.manifest);
        atomic(join(this.evidence, "result.json"), this.result);
    }
    record(
        stage: string,
        documentType: "observations" | "measurements",
        payload: Record<string, unknown>,
    ): void {
        if (this.finalized || !/^[a-z0-9-]+$/.test(stage) || !safePath(stage))
            throw Error("Invalid stage record");
        const directory = join(this.evidence, "stages", stage);
        mkdirSync(directory, { recursive: true });
        atomic(join(directory, `${documentType}.json`), {
            ...payload,
            ...header(documentType, this.manifest.runId),
        });
    }
    async stage(id: string, action: () => Promise<void>, required = true): Promise<void> {
        if (
            this.finalized ||
            !/^[a-z0-9-]+$/.test(id) ||
            this.result.stages.some((s) => s.id === id)
        )
            throw Error("Invalid or duplicate stage");
        const stage: Stage = { ...pending(), id, required, execution: "running" };
        this.result.stages.push(stage);
        this.result.execution = "running";
        this.persist();
        try {
            await action();
            stage.execution = "completed";
            stage.correctness = "passed";
        } catch (error) {
            stage.execution = "failed";
            stage.correctness = "failed";
            throw error;
        } finally {
            this.persist();
        }
    }
    async execute(action: () => Promise<void>, diagnostics?: () => Promise<void>): Promise<Result> {
        if (this.finalized) throw Error("Run already finalized");
        try {
            await action();
        } catch (error) {
            this.manifest.preparation = "failed";
            this.result.failures.push({ kind: "scenario", message: failureText(error) });
            if (diagnostics)
                try {
                    await diagnostics();
                } catch (diagnostic) {
                    this.result.failures.push({
                        kind: "diagnostic",
                        message: failureText(diagnostic),
                    });
                }
        } finally {
            await cleanupSteps(this.cleanup, this.result.cleanupRecords);
        }
        const r = this.result;
        for (const step of r.cleanupRecords)
            if (step.status === "failed")
                r.failures.push({ kind: "cleanup", message: `${step.resource}: ${step.error}` });
        r.cleanup = r.cleanupRecords.some((s) => s.status === "failed") ? "failed" : "passed";
        r.execution = r.failures.some((f) => f.kind === "scenario") ? "failed" : "completed";
        const checks = (field: "correctness" | "budgets"): Check => {
            const values = r.stages.filter((s) => s.required).map((s) => s[field]);
            return values.includes("failed")
                ? "failed"
                : values.length && values.every((v) => v === "passed")
                  ? "passed"
                  : "not evaluated";
        };
        r.correctness = checks("correctness");
        r.budgets = checks("budgets");
        for (const stage of r.stages) {
            stage.cleanup = r.cleanup;
            stage.evidence = "complete";
        }
        // Persist a nonterminal record before attempting the final evidence transaction.
        this.persist();
        try {
            r.evidence = "complete";
            r.accepted =
                accepts(r) &&
                r.stages.length > 0 &&
                r.stages.filter((s) => s.required).every(accepts) &&
                !r.failures.length;
            readManifest(this.manifest);
            readResult(r);
            atomic(join(this.evidence, "manifest.json"), this.manifest);
            writeFileSync(join(this.evidence, "report.md"), report(this.manifest, r));
            const finalResult = JSON.stringify(r, null, 2) + "\n";
            const files = Object.entries(identities(this.evidence))
                .filter(([path]) => path !== "artifacts.json")
                .map(([path, sha256]) => ({
                    path,
                    sha256: path === "result.json" ? hash(finalResult) : sha256,
                    bytes:
                        path === "result.json"
                            ? Buffer.byteLength(finalResult)
                            : readFileSync(join(this.evidence, path)).length,
                }));
            atomic(join(this.evidence, "artifacts.json"), {
                ...header("artifacts", r.runId),
                files,
            });
            // Commit success last. A crash before this point leaves a partial result.
            atomic(join(this.evidence, "result.json"), r);
        } catch (error) {
            r.evidence = "partial";
            r.accepted = false;
            r.failures.push({ kind: "evidence", message: failureText(error) });
            try {
                atomic(join(this.evidence, "result.json"), r);
            } catch {
                /* Earlier partial record remains; missing inventory prevents reuse. */
            }
            throw error;
        } finally {
            this.finalized = true;
        }
        return r;
    }
}
