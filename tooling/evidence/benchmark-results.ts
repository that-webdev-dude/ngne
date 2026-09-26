import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { contained, hash, safePath } from "./identity.js";
import {
    object,
    readArtifacts,
    readHeader,
    readManifest,
    readResult,
    type Manifest,
    type Result,
} from "./schema.js";
import { loadRun, readJson, validateResult } from "./run-results.mjs";
import { legacyFormat } from "./legacy-format.js";

export function benchmarkMeasurements(directory: string, manifest: Manifest, result: Result) {
    const parameters = object(manifest.policy.parameters);
    if (parameters.workload !== "all" && parameters.workload !== "churn")
        throw Error("Unknown benchmark workload");
    if (typeof parameters.diagnostics !== "boolean") throw Error("Missing diagnostics selection");
    const expected =
        parameters.workload === "churn"
            ? ["churn"]
            : [
                  "cpu",
                  "churn",
                  "renderer-webgpu",
                  "renderer-webgpu-alternating",
                  "starfall-chaos",
                  "platformer",
              ];
    if (parameters.diagnostics) expected.push("churn-alloc", "churn-gc");
    const results = new Map<string, { path: string; value: ReturnType<typeof readJson> }>();
    for (const stage of result.stages) {
        if (!safePath(stage.id) || stage.id.includes("/")) throw Error("Unsafe benchmark stage");
        if (!expected.includes(stage.id)) {
            if (!["build-production", "build-browser"].includes(stage.id))
                throw Error(`Unknown benchmark stage: ${stage.id}`);
            continue;
        }
        const relative = `stages/${stage.id}/measurements.json`;
        if (!existsSync(join(directory, relative))) {
            if (stage.execution === "completed" && stage.correctness === "passed")
                throw Error(`Missing measurements: ${stage.id}`);
            continue;
        }
        const path = contained(directory, relative),
            measurement = object(readJson(path));
        if (readHeader(measurement, "measurements").runId !== manifest.runId)
            throw Error("Measurement run identity mismatch");
        if (measurement.target !== "internal-source-microbenchmark")
            throw Error("Unexpected measurement target");
        validateResult(stage.id, measurement.raw);
        results.set(stage.id, { path, value: measurement.raw });
    }
    if (result.accepted || (manifest.preparation === "prepared" && !result.failures.length))
        for (const name of expected) {
            const stage = result.stages.find((s) => s.id === name);
            if (
                !stage ||
                !stage.required ||
                stage.execution !== "completed" ||
                stage.correctness !== "passed" ||
                !results.has(name)
            )
                throw Error(`Missing expected workload: ${name}`);
        }
    return results;
}

/** Current run roots are authoritative; historical files are read only when explicitly selected. */
export function loadBenchmarkRun(input: string, role: string): ReturnType<typeof loadRun> {
    const root = resolve(input);
    const directory = existsSync(join(root, "evidence")) ? join(root, "evidence") : root;
    const rawManifest = readJson(join(directory, "manifest.json"));
    if (rawManifest.format === undefined && rawManifest.documentType === undefined) {
        legacyFormat("benchmark-legacy", rawManifest);
        return loadRun(directory, role);
    }
    const manifest = readManifest(rawManifest);
    if (manifest.suite !== "benchmarks") throw Error("Expected benchmarks suite");
    const artifacts = readArtifacts(readJson(contained(directory, "artifacts.json")));
    if (artifacts.runId !== manifest.runId) throw Error("Artifact run identity mismatch");
    const listed = new Set(artifacts.files.map((f) => f.path));
    for (const file of artifacts.files) {
        const bytes = readFileSync(contained(directory, file.path));
        if (bytes.length !== file.bytes || hash(bytes) !== file.sha256)
            throw Error(`Changed artifact: ${file.path}`);
    }
    for (const name of ["manifest.json", "result.json", "report.md"])
        if (!listed.has(name)) throw Error(`Missing required artifact: ${name}`);
    const result = readResult(readJson(contained(directory, "result.json")));
    if (result.runId !== manifest.runId) throw Error("Result run identity mismatch");
    if (result.evidence !== "complete") throw Error("Incomplete benchmark evidence");
    if (result.accepted && manifest.preparation !== "prepared")
        throw Error("Accepted benchmark was not prepared");
    const results = benchmarkMeasurements(directory, manifest, result);
    for (const name of results.keys())
        if (!listed.has(`stages/${name}/measurements.json`))
            throw Error(`Unlisted measurements: ${name}`);
    const environment = manifest.environment;
    return {
        role,
        directory: root,
        manifestPath: join(directory, "manifest.json"),
        reportPath: join(directory, "report.md"),
        results,
        manifest: {
            schemaVersion: manifest.schemaVersion,
            status: result.accepted ? "passed" : "failed",
            revision: manifest.provenance?.revision,
            startedAt: manifest.startedAt,
            parameters: manifest.policy.parameters,
            environment: {
                ...environment,
                machine: JSON.stringify(manifest.policy.hardware),
                os: `${environment.platform}/${environment.release}/${environment.arch}`,
            },
            stages: result.stages.map((s) => ({
                name: s.id,
                kind: results.has(s.id) ? "benchmark" : "command",
                status:
                    s.execution === "completed" &&
                    s.correctness === "passed" &&
                    s.cleanup === "passed"
                        ? "passed"
                        : "failed",
            })),
        },
    };
}
