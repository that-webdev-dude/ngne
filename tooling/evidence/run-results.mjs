import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

export function validateChurn(result, mode) {
    const fail = (message) => {
        throw new Error(`Invalid churn ${mode}: ${message}`);
    };
    if (result?.mode !== mode || result.api !== "schema") fail("mode/API mismatch");
    for (const [name, value] of Object.entries({
        LIVE: 10000,
        PER_COMMIT: 1000,
        WARMUP_COMMITS: 100,
        SAMPLE_COMMITS: 1000,
        RETAINED_EVERY: 100,
    }))
        if (result.parameters?.[name] !== value) fail(`wrong ${name}`);
    if (!result.node || !result.cpu || !result.revision || result.revision === "unknown")
        fail("missing provenance");
    if (
        !result.sourceHashes ||
        Object.keys(result.sourceHashes).length < 3 ||
        Object.values(result.sourceHashes).some((value) => !/^[a-f0-9]{64}$/.test(value))
    )
        fail("missing source hashes");
    if (mode === "timed") {
        if (
            result.rawBatchMs?.length !== 1000 ||
            result.rawBatchMs.some((value) => !Number.isFinite(value) || value < 0)
        )
            fail("wrong timing samples");
        if (
            result.batchMs?.samples !== 1000 ||
            ["p50", "p95", "p99"].some((key) => !Number.isFinite(result.batchMs[key]))
        )
            fail("missing percentiles");
    } else if (mode === "alloc") {
        if (!(result.allocation?.sampledBytes > 0) || result.retainedHeapBytes?.length !== 11)
            fail("missing allocation/retained samples");
        for (let i = 0; i <= 10; i++)
            if (
                result.retainedHeapBytes[i].afterCommit !== i * 100 ||
                !Number.isFinite(result.retainedHeapBytes[i].heapUsed)
            )
                fail("invalid retained samples");
    } else if (mode === "gc") {
        if (
            result.gcTrace?.accepted !== true ||
            !(result.gcTrace.windowCount > 0) ||
            !Number.isFinite(result.gcTrace.windowPauseTotalMs)
        )
            fail("GC trace not accepted");
    } else fail("unknown mode");
}

function stageName(name) {
    if (typeof name !== "string" || !/^[a-z0-9-]+$/.test(name))
        throw new Error("Invalid stage name");
    return name;
}

export function validateResult(name, result) {
    if (name.startsWith("churn")) {
        validateChurn(result, name === "churn" ? "timed" : name.slice(6));
    } else if (name === "cpu") {
        if (result.collisionGrid?.valid !== true)
            throw new Error("Invalid CPU collision-grid measurement");
    } else if (
        result.pageError ||
        result.rendererEvidence?.error ||
        result.visibilityState?.atStart !== "visible" ||
        result.visibilityState?.atEnd !== "visible" ||
        result.visibilityChanges?.length ||
        result.gpu?.isFallbackAdapter ||
        result.backend?.adapter?.isFallbackAdapter ||
        result.run?.survivingOwnedProcesses?.length
    ) {
        throw new Error(`Invalid browser evidence: ${name}`);
    }
}

export function collectAnalysis(directory) {
    const manifest = readJson(join(directory, "manifest.json"));
    const stages = manifest.stages.map((stage) => {
        const name = stageName(stage.name),
            path = join(directory, name, "result.json");
        let result = null;
        if (stage.kind === "benchmark" && existsSync(path)) {
            try {
                result = readJson(path);
            } catch (error) {
                if (stage.status === "passed") throw error;
            }
        }
        if (
            stage.kind === "benchmark" &&
            stage.status === "passed" &&
            (!result || typeof result !== "object")
        )
            throw new Error(`Missing result: ${name}`);
        if (stage.kind === "benchmark" && stage.status === "passed") validateResult(name, result);
        return {
            name,
            kind: stage.kind,
            status: stage.status,
            validationError: stage.validationError ?? null,
            result,
            resultHash: digest(result),
        };
    });
    const analysis = {
        schemaVersion: 1,
        revision: manifest.revision,
        startedAt: manifest.startedAt,
        parameters: manifest.parameters,
        environment: manifest.environment,
        stages,
    };
    save(join(directory, "analysis.json"), analysis);
    validateAnalysis(directory);
    return analysis;
}

export function validateAnalysis(directory) {
    const manifest = readJson(join(directory, "manifest.json"));
    const analysis = readJson(join(directory, "analysis.json"));
    if (manifest.status === "passed") {
        const expected =
            manifest.parameters.workload === "churn"
                ? ["churn"]
                : [
                      "cpu",
                      "churn",
                      "renderer-webgpu",
                      "renderer-webgpu-alternating",
                      "starfall-chaos",
                      "platformer",
                  ];
        if (manifest.parameters.diagnostics) expected.push("churn-alloc", "churn-gc");
        for (const name of expected)
            if (
                !manifest.stages.some(
                    (stage) =>
                        stage.name === name &&
                        stage.kind === "benchmark" &&
                        stage.status === "passed",
                )
            )
                throw new Error(`Missing expected workload: ${name}`);
    }
    if (
        analysis.schemaVersion !== 1 ||
        analysis.revision !== manifest.revision ||
        analysis.startedAt !== manifest.startedAt ||
        digest(analysis.parameters) !== digest(manifest.parameters) ||
        digest(analysis.environment) !== digest(manifest.environment)
    )
        throw new Error("Analysis provenance mismatch");
    if (
        !Array.isArray(analysis.stages) ||
        analysis.stages.length !== manifest.stages.length ||
        new Set(analysis.stages.map((s) => s.name)).size !== analysis.stages.length
    )
        throw new Error("Analysis stages mismatch");
    for (const stage of manifest.stages) {
        stageName(stage.name);
        const entry = analysis.stages.find((s) => s.name === stage.name);
        if (
            !entry ||
            entry.kind !== stage.kind ||
            entry.status !== stage.status ||
            digest(entry.result) !== entry.resultHash
        )
            throw new Error(`Analysis mismatch: ${stage.name}`);
        if (
            stage.kind === "benchmark" &&
            stage.status === "passed" &&
            (!entry.result || typeof entry.result !== "object")
        )
            throw new Error(`Missing result: ${stage.name}`);
        if (stage.kind === "benchmark" && stage.status === "passed")
            validateResult(stage.name, entry.result);
        const path = join(directory, stage.name, "result.json");
        if (
            existsSync(path) &&
            stage.status === "passed" &&
            digest(readJson(path)) !== entry.resultHash
        )
            throw new Error(`Result mismatch: ${stage.name}`);
    }
    return analysis;
}

export function loadRun(directory, role) {
    directory = resolve(directory);
    const manifestPath = join(directory, "manifest.json"),
        manifest = readJson(manifestPath);
    const results = new Map();
    if (existsSync(join(directory, "analysis.json"))) {
        for (const stage of validateAnalysis(directory).stages)
            if (stage.kind === "benchmark" && stage.result)
                results.set(stage.name, {
                    path: join(directory, "analysis.json"),
                    value: stage.result,
                });
    } else {
        if (manifest.schemaVersion >= 2 || manifest.retention?.mode === "compact")
            throw new Error("Missing consolidated analysis");
        for (const stage of manifest.stages ?? []) {
            if (stage.kind !== "benchmark") continue;
            const path = join(directory, stageName(stage.name), "result.json");
            if (existsSync(path)) results.set(stage.name, { path, value: readJson(path) });
            else if (stage.status === "passed") throw new Error(`Missing result: ${stage.name}`);
        }
    }
    return {
        role,
        directory,
        manifestPath,
        reportPath: join(directory, "summary.md"),
        manifest,
        results,
    };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [command, path, mode, parsed] = process.argv.slice(2);
        if (command === "collect") collectAnalysis(path);
        else if (command === "validate") validateAnalysis(path);
        else if (command === "validate-churn") {
            const result = readJson(path);
            if (mode === "gc") result.gcTrace = readJson(parsed);
            validateChurn(result, mode);
            if (mode === "alloc") {
                const profilePath = resolve(result.allocation.profilePath);
                if (
                    !profilePath.startsWith(resolve(dirname(path)) + sep) ||
                    basename(profilePath) !== "allocation.heapprofile"
                )
                    throw new Error("Invalid allocation profile path");
                const profile = readJson(profilePath);
                if (!profile.head || !Array.isArray(profile.samples) || !profile.samples.length)
                    throw new Error("Empty allocation profile");
            }
            save(path, result);
        } else throw new Error("Unknown result operation");
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
