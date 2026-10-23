import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { arch, platform, release } from "node:os";
import { cleanupSteps, failureText, type CleanupStep } from "./cleanup.mjs";
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
import { atomic, EvidenceWriteError, type AtomicWriter } from "./atomic.js";

export { atomic } from "./atomic.js";
const pending = (): Outcome => ({
    execution: "pending",
    correctness: "not evaluated",
    budgets: "not evaluated",
    cleanup: "pending",
    evidence: "partial",
});

/** Only this runner-owned wrapper may be peeled when recording scenario failures. */
class StagePersistenceError extends AggregateError {
    constructor(
        id: string,
        readonly original: unknown,
        persistence: unknown,
    ) {
        super([original, persistence], `Stage ${id} and persistence failed`, { cause: original });
    }
}

/** Lifecycle extracted from content/run.mjs; independent outcomes are intentionally new. */
export class Run {
    readonly root: string;
    readonly evidence: string;
    readonly manifest: Manifest;
    readonly result: Result;
    readonly cleanup: CleanupStep[] = [];
    private finalized = false;
    private readonly evidenceErrors = new Set<unknown>();

    constructor(
        repository: string,
        suite: string,
        output?: string,
        private readonly writeJson: AtomicWriter = atomic,
    ) {
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
        try {
            this.persist();
        } catch (error) {
            this.result.execution = "failed";
            this.finalized = true;
            this.failedPublication(error);
        }
    }
    private evidenceFailure(error: unknown): void {
        this.result.evidence = "partial";
        this.result.accepted = false;
        for (const stage of this.result.stages) stage.evidence = "partial";
        if (!this.evidenceErrors.has(error)) {
            this.evidenceErrors.add(error);
            this.result.failures.push({ kind: "evidence", message: failureText(error) });
            if (error instanceof EvidenceWriteError)
                for (const failure of error.cleanupFailures) {
                    const message = failureText(failure.error);
                    this.result.cleanupRecords.push({
                        resource: failure.resource,
                        status: "failed",
                        error: message,
                    });
                    this.result.failures.push({
                        kind: "cleanup",
                        message: `${failure.resource}: ${message}`,
                    });
                    this.result.cleanup = "failed";
                    for (const stage of this.result.stages) stage.cleanup = "failed";
                }
        }
    }
    private write(path: string, value: unknown): void {
        try {
            this.writeJson(path, value);
        } catch (error) {
            this.evidenceFailure(error);
            throw error;
        }
    }
    private scenarioErrors(error: unknown): unknown[] {
        if (this.evidenceErrors.has(error)) return [];
        if (error instanceof StagePersistenceError) return this.scenarioErrors(error.original);
        return [error];
    }
    private failedPublication(error: unknown): never {
        this.evidenceFailure(error);
        const errors = [error];
        try {
            this.write(join(this.evidence, "result.json"), this.result);
        } catch (fallback) {
            errors.push(fallback);
        }
        throw new AggregateError(
            errors,
            `Evidence publication failed: ${this.evidence}; ${this.result.failures.map((f) => `${f.kind}: ${f.message}`).join("; ")}`,
            { cause: error },
        );
    }
    persist(): void {
        try {
            readManifest(this.manifest);
            readResult(this.result);
            this.write(join(this.evidence, "manifest.json"), this.manifest);
            this.write(join(this.evidence, "result.json"), this.result);
        } catch (error) {
            this.evidenceFailure(error);
            throw error;
        }
    }
    record(
        stage: string,
        documentType: "observations" | "measurements",
        payload: Record<string, unknown>,
    ): void {
        if (this.finalized || !/^[a-z0-9-]+$/.test(stage) || !safePath(stage))
            throw Error("Invalid stage record");
        const directory = join(this.evidence, "stages", stage);
        try {
            mkdirSync(directory, { recursive: true });
            this.write(join(directory, `${documentType}.json`), {
                ...payload,
                ...header(documentType, this.manifest.runId),
            });
        } catch (error) {
            this.evidenceFailure(error);
            throw error;
        }
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
        let failed = false;
        let actionStarted = false;
        let original: unknown;
        try {
            this.persist();
            actionStarted = true;
            await action();
            stage.execution = "completed";
            stage.correctness = "passed";
        } catch (error) {
            stage.execution = "failed";
            if (actionStarted) stage.correctness = "failed";
            failed = true;
            original = error;
        }
        try {
            this.persist();
        } catch (error) {
            if (failed) throw new StagePersistenceError(id, original, error);
            throw error;
        }
        if (failed) throw original;
    }
    async execute(action: () => Promise<void>, diagnostics?: () => Promise<void>): Promise<Result> {
        if (this.finalized) throw Error("Run already finalized");
        let executionFailed = false;
        try {
            await action();
        } catch (error) {
            executionFailed = true;
            this.manifest.preparation = "failed";
            for (const cause of this.scenarioErrors(error))
                this.result.failures.push({ kind: "scenario", message: failureText(cause) });
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
            if (
                step.status === "failed" &&
                !r.failures.some(
                    (f) => f.kind === "cleanup" && f.message === `${step.resource}: ${step.error}`,
                )
            )
                r.failures.push({ kind: "cleanup", message: `${step.resource}: ${step.error}` });
        r.cleanup = r.cleanupRecords.some((s) => s.status === "failed") ? "failed" : "passed";
        r.execution =
            executionFailed || r.failures.some((f) => f.kind === "scenario")
                ? "failed"
                : "completed";
        const checks = (field: "correctness" | "budgets"): Check => {
            const values = r.stages.filter((s) => s.required).map((s) => s[field]);
            return values.includes("failed")
                ? "failed"
                : values.includes("passed") &&
                    (field === "budgets" || values.every((v) => v === "passed"))
                  ? "passed"
                  : "not evaluated";
        };
        r.correctness = checks("correctness");
        r.budgets = checks("budgets");
        const evidence = r.failures.some((f) => f.kind === "evidence") ? "partial" : "complete";
        for (const stage of r.stages) {
            stage.cleanup = r.cleanup;
            stage.evidence = evidence;
        }
        try {
            // Persist a nonterminal record before attempting the final evidence transaction.
            this.persist();
            r.evidence = evidence;
            r.accepted =
                accepts(r) &&
                r.stages.length > 0 &&
                r.stages.filter((s) => s.required).every(accepts) &&
                !r.failures.length;
            readManifest(this.manifest);
            readResult(r);
            this.write(join(this.evidence, "manifest.json"), this.manifest);
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
            this.write(join(this.evidence, "artifacts.json"), {
                ...header("artifacts", r.runId),
                files,
            });
            // Commit success last. A crash before this point leaves a partial result.
            this.write(join(this.evidence, "result.json"), r);
        } catch (error) {
            this.failedPublication(error);
        } finally {
            this.finalized = true;
        }
        return r;
    }
}
