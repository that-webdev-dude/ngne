import { safePath, type Identities } from "./identity.js";
import type { CleanupRecord } from "../core/cleanup.mjs";

export interface Header {
    format: "ngne-tooling";
    documentType: string;
    schemaVersion: 1;
    runId: string;
}
export const header = (documentType: string, runId: string): Header => ({
    format: "ngne-tooling",
    documentType,
    schemaVersion: 1,
    runId,
});
export type Check = "passed" | "failed" | "not evaluated";
export interface Outcome {
    execution: "pending" | "running" | "completed" | "failed" | "interrupted";
    correctness: Check;
    budgets: Check;
    cleanup: "pending" | "passed" | "failed";
    evidence: "partial" | "complete";
}
export interface Failure {
    kind: "scenario" | "diagnostic" | "cleanup" | "evidence";
    message: string;
}
export interface Stage extends Outcome {
    id: string;
    required: boolean;
}
export interface Result extends Header, Outcome {
    stages: Stage[];
    failures: Failure[];
    cleanupRecords: CleanupRecord[];
    accepted: boolean;
}
export interface Tree {
    path: string;
    files: Identities;
}
export interface Prepared {
    package: { path: string; filename: string; sha256: string; files: Identities };
    installed: Tree;
    workload: Tree;
    dependencies: Tree;
    builds: { root: Tree; nested: Tree };
    toolchain: { node: string; npm: string; typescript: string };
    dependencyPolicy: "offline-lockfile-ci-no-scripts";
}
export interface Manifest extends Header {
    suite: string;
    startedAt: string;
    preparation: "pending" | "running" | "prepared" | "failed";
    provenance: { revision: string; changes: string } | null;
    environment: { node: string; platform: string; release: string; arch: string };
    harness: Identities;
    policy: Record<string, unknown>;
    prepared: Prepared | null;
}
export interface Artifacts extends Header {
    files: { path: string; sha256: string; bytes: number }[];
}

export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected object");
    return value as Record<string, unknown>;
}
export function string(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw Error("Expected nonempty string");
    return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
    if (!choices.includes(value as T)) throw Error(`Invalid value: ${String(value)}`);
    return value as T;
}
function array<T>(value: unknown, parse: (value: unknown) => T): T[] {
    if (!Array.isArray(value)) throw Error("Expected array");
    return value.map(parse);
}
export function readHeader(value: unknown, type: string): Header {
    const v = object(value);
    if (v.format !== "ngne-tooling" || v.schemaVersion !== 1 || v.documentType !== type)
        throw Error(`Unsupported ${type} format/schema`);
    return header(type, string(v.runId));
}
function path(value: unknown): string {
    const p = string(value);
    if (!safePath(p)) throw Error(`Unsafe relative path: ${p}`);
    return p;
}
export function sha(value: unknown): string {
    const s = string(value);
    if (!/^[a-f0-9]{64}$/.test(s)) throw Error("Invalid SHA-256");
    return s;
}
export function files(value: unknown): Identities {
    const entries = Object.entries(object(value));
    if (!entries.length) throw Error("Empty required inventory");
    return Object.fromEntries(entries.map(([p, s]) => [path(p), sha(s)]));
}
function tree(value: unknown): Tree {
    const v = object(value);
    return { path: path(v.path), files: files(v.files) };
}
function prepared(value: unknown): Prepared {
    const v = object(value),
        pkg = object(v.package),
        builds = object(v.builds),
        toolchain = object(v.toolchain);
    const filename = path(pkg.filename);
    if (filename.includes("/")) throw Error("Package filename must be a basename");
    return {
        package: {
            path: path(pkg.path),
            filename,
            sha256: sha(pkg.sha256),
            files: files(pkg.files),
        },
        installed: tree(v.installed),
        workload: tree(v.workload),
        dependencies: tree(v.dependencies),
        builds: { root: tree(builds.root), nested: tree(builds.nested) },
        toolchain: {
            node: string(toolchain.node),
            npm: string(toolchain.npm),
            typescript: string(toolchain.typescript),
        },
        dependencyPolicy: choice(v.dependencyPolicy, ["offline-lockfile-ci-no-scripts"]),
    };
}
export function readManifest(value: unknown): Manifest {
    const h = readHeader(value, "manifest"),
        v = object(value),
        env = object(v.environment);
    const p = v.provenance === null ? null : object(v.provenance);
    return {
        ...h,
        suite: string(v.suite),
        startedAt: string(v.startedAt),
        preparation: choice(v.preparation, ["pending", "running", "prepared", "failed"]),
        provenance:
            p === null
                ? null
                : {
                      revision: string(p.revision),
                      changes: typeof p.changes === "string" ? p.changes : string(p.changes),
                  },
        environment: {
            node: string(env.node),
            platform: string(env.platform),
            release: string(env.release),
            arch: string(env.arch),
        },
        harness: Object.keys(object(v.harness)).length ? files(v.harness) : {},
        policy: object(v.policy),
        prepared: v.prepared === null ? null : prepared(v.prepared),
    };
}
function outcome(value: unknown): Outcome {
    const v = object(value);
    return {
        execution: choice(v.execution, [
            "pending",
            "running",
            "completed",
            "failed",
            "interrupted",
        ]),
        correctness: choice(v.correctness, ["passed", "failed", "not evaluated"]),
        budgets: choice(v.budgets, ["passed", "failed", "not evaluated"]),
        cleanup: choice(v.cleanup, ["pending", "passed", "failed"]),
        evidence: choice(v.evidence, ["partial", "complete"]),
    };
}
export function accepts(v: Outcome): boolean {
    return (
        v.execution === "completed" &&
        v.correctness === "passed" &&
        v.budgets !== "failed" &&
        v.cleanup === "passed" &&
        v.evidence === "complete"
    );
}
export function readResult(value: unknown): Result {
    const h = readHeader(value, "result"),
        v = object(value);
    const stages = array(v.stages, (s): Stage => {
        const row = object(s);
        if (typeof row.required !== "boolean") throw Error("Missing stage requirement");
        return { ...outcome(s), id: string(row.id), required: row.required };
    });
    if (new Set(stages.map((s) => s.id)).size !== stages.length) throw Error("Duplicate stages");
    const failures = array(v.failures, (f): Failure => {
        const row = object(f);
        return {
            kind: choice(row.kind, ["scenario", "diagnostic", "cleanup", "evidence"]),
            message: string(row.message),
        };
    });
    const cleanupRecords = array(v.cleanupRecords, (c): CleanupRecord => {
        const row = object(c),
            status = choice(row.status, ["passed", "failed"]);
        return {
            resource: string(row.resource),
            status,
            ...(status === "failed" ? { error: string(row.error) } : {}),
            detail: row.detail,
        };
    });
    const dimensions = outcome(v);
    const accepted =
        accepts(dimensions) &&
        stages.length > 0 &&
        stages.filter((s) => s.required).every(accepts) &&
        !failures.length;
    if (typeof v.accepted !== "boolean" || v.accepted !== accepted)
        throw Error("Inconsistent acceptance outcome");
    if (dimensions.cleanup === "passed" && cleanupRecords.some((c) => c.status === "failed"))
        throw Error("Inconsistent cleanup outcome");
    return { ...h, ...dimensions, stages, failures, cleanupRecords, accepted };
}
export function readArtifacts(value: unknown): Artifacts {
    const h = readHeader(value, "artifacts"),
        v = object(value);
    const entries = array(v.files, (f) => {
        const row = object(f);
        if (!Number.isSafeInteger(row.bytes) || Number(row.bytes) < 0)
            throw Error("Invalid artifact size");
        return { path: path(row.path), sha256: sha(row.sha256), bytes: Number(row.bytes) };
    });
    if (new Set(entries.map((f) => f.path)).size !== entries.length)
        throw Error("Duplicate artifacts");
    return { ...h, files: entries };
}
