import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
    object,
    string,
    sha,
    readHeader,
    readManifest,
    readResult,
    readArtifacts,
} from "../../../evidence/schema.js";
import { contained, hash } from "../../../evidence/identity.js";
import { readMeasurement } from "./measurement.js";

export interface EnvironmentProfile {
    schemaVersion: 1;
    name: string;
    expected: Record<string, unknown>;
}
export function readProfile(value: unknown): EnvironmentProfile {
    const v = object(value),
        expected = object(v.expected);
    if (v.schemaVersion !== 1 || !/^[a-z0-9-]+$/.test(string(v.name)))
        throw Error("Invalid environment profile");
    for (const key of [
        "node",
        "platform",
        "release",
        "arch",
        "cpu",
        "browserProduct",
        "browserRevision",
        "browserUserAgent",
    ])
        string(expected[key]);
    if (
        !Number.isSafeInteger(expected.logicalCores) ||
        Number(expected.logicalCores) < 1 ||
        !Number.isSafeInteger(expected.totalMemory) ||
        Number(expected.totalMemory) < 1
    )
        throw Error("Missing hardware observations");
    if (
        expected.headless !== false ||
        expected.visibility !== "visible" ||
        expected.dpr !== 1 ||
        !isDeepStrictEqual(expected.viewport, [1280, 900])
    )
        throw Error("Controlled profiles require headed visible 1280x900 DPR 1");
    const gpu = object(expected.gpu);
    for (const key of ["vendor", "architecture", "device", "description"])
        if (typeof gpu[key] !== "string") throw Error(`Missing GPU ${key}`);
    if (gpu.isFallbackAdapter !== false || !gpu.vendor) throw Error("Physical adapter required");
    if (
        !Array.isArray(expected.flags) ||
        !expected.flags.length ||
        expected.flags.some((f) => typeof f !== "string" || f.includes("headless"))
    )
        throw Error("Missing or invalid browser flags");
    return { schemaVersion: 1, name: string(v.name), expected };
}
export function environmentMismatches(
    profile: EnvironmentProfile,
    observed: Record<string, unknown>,
): string[] {
    return Object.keys(profile.expected)
        .filter((key) => !isDeepStrictEqual(profile.expected[key], observed[key]))
        .map(
            (key) =>
                `environment.${key}: expected ${JSON.stringify(profile.expected[key])}; observed ${JSON.stringify(observed[key])}`,
        );
}
export interface Budget {
    format: "ngne-tooling";
    documentType: "benchmark-budget";
    schemaVersion: 1;
    runId: string;
    profile: EnvironmentProfile;
    signature: string;
    p95Ms: number;
    method: "maximum-repetition-p95-times-1.2";
    baselines: { runId: string; manifestSHA256: string; resultSHA256: string; p95Ms: number[] }[];
}
export function readBudget(value: unknown): Budget {
    const h = readHeader(value, "benchmark-budget"),
        v = object(value);
    if (
        v.method !== "maximum-repetition-p95-times-1.2" ||
        typeof v.p95Ms !== "number" ||
        !Number.isFinite(v.p95Ms) ||
        v.p95Ms <= 0 ||
        !Array.isArray(v.baselines) ||
        v.baselines.length < 3
    )
        throw Error("Invalid measured budget");
    const baselines = v.baselines.map((value) => {
        const b = object(value);
        if (
            !Array.isArray(b.p95Ms) ||
            b.p95Ms.length !== 3 ||
            b.p95Ms.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0)
        )
            throw Error("Incomplete baseline repetitions");
        return {
            runId: string(b.runId),
            manifestSHA256: sha(b.manifestSHA256),
            resultSHA256: sha(b.resultSHA256),
            p95Ms: b.p95Ms as number[],
        };
    });
    if (
        new Set(baselines.map((b) => b.runId)).size !== baselines.length ||
        v.p95Ms !== Math.max(...baselines.flatMap((b) => b.p95Ms)) * 1.2
    )
        throw Error("Budget does not match baseline evidence");
    return {
        ...h,
        format: "ngne-tooling",
        documentType: "benchmark-budget",
        schemaVersion: 1,
        profile: readProfile(v.profile),
        signature: sha(v.signature),
        p95Ms: v.p95Ms,
        method: v.method,
        baselines,
    };
}

/** Validate every payload before using a measurement to establish a budget. */
export function baselineEvidence(evidence: string) {
    const bytes = (p: string) => readFileSync(contained(evidence, p));
    const manifest = readManifest(JSON.parse(bytes("manifest.json").toString())),
        result = readResult(JSON.parse(bytes("result.json").toString())),
        artifacts = readArtifacts(JSON.parse(bytes("artifacts.json").toString()));
    if (
        manifest.runId !== result.runId ||
        manifest.runId !== artifacts.runId ||
        manifest.suite !== "content-engine" ||
        manifest.preparation !== "prepared" ||
        !manifest.prepared ||
        !result.accepted ||
        result.execution !== "completed" ||
        result.cleanup !== "passed" ||
        result.correctness !== "passed" ||
        result.evidence !== "complete" ||
        manifest.policy.mode !== "baseline" ||
        manifest.policy.smoke !== false
    )
        throw Error(
            "Baseline requires complete correct full profile-validated execution and cleanup",
        );
    for (const file of artifacts.files) {
        const b = bytes(file.path);
        if (b.length !== file.bytes || hash(b) !== file.sha256)
            throw Error(`Corrupt baseline artifact ${file.path}`);
    }
    const pkg = manifest.prepared.package;
    if (!pkg.path.startsWith("evidence/"))
        throw Error("Baseline package was not retained in evidence");
    const packagePath = pkg.path.slice("evidence/".length);
    if (hash(bytes(packagePath)) !== pkg.sha256)
        throw Error("Baseline engine package identity mismatch");
    for (const required of [
        "manifest.json",
        "result.json",
        packagePath,
        ...Array.from({ length: 3 }, (_, i) => `stages/repetition-${i}/measurements.json`),
    ])
        if (!artifacts.files.some((f) => f.path === required))
            throw Error(`Missing baseline inventory ${required}`);
    const p95Ms = Array.from({ length: 3 }, (_, i) => {
        if (
            !result.stages.some(
                (s) =>
                    s.id === `repetition-${i}` &&
                    s.execution === "completed" &&
                    s.correctness === "passed",
            )
        )
            throw Error("Missing baseline repetition");
        const value = object(
            JSON.parse(bytes(`stages/repetition-${i}/measurements.json`).toString()),
        );
        const header = readHeader(value, "measurements");
        if (header.runId !== manifest.runId) throw Error("Cross-run measurement");
        const metrics = readMeasurement(value.raw, 120);
        if (!isDeepStrictEqual(metrics, value.metrics))
            throw Error("Baseline metrics do not match raw samples");
        const profile = readProfile(manifest.policy.profile);
        if (
            environmentMismatches(profile, object(value.observed)).length ||
            !isDeepStrictEqual(value.environmentMismatches, [])
        )
            throw Error("Baseline environment mismatch");
        return metrics.p95;
    });
    return {
        manifest,
        row: {
            runId: manifest.runId,
            manifestSHA256: hash(bytes("manifest.json")),
            resultSHA256: hash(bytes("result.json")),
            p95Ms,
        },
    };
}

export function loadProfile(repository: string, name: string): EnvironmentProfile {
    if (!/^[a-z0-9-]+$/.test(name)) throw Error("Select a named environment profile");
    const profile = readProfile(
        JSON.parse(
            readFileSync(join(repository, "tooling/profiles/environments", `${name}.json`), "utf8"),
        ),
    );
    if (profile.name !== name) throw Error("Profile name mismatch");
    return profile;
}
