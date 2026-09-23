import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contained, hash, identities, type Identities } from "./identity.js";
import {
    files,
    object,
    readArtifacts,
    readHeader,
    readResult,
    sha,
    string,
    type Header,
} from "./schema.js";

export interface ConsumerManifest extends Header {
    contractVersion: 1;
    package: { filename: string; path: string; sha256: string };
    installed: Identities;
    consumer: { revision: string; source: Identities; lock: Identities };
    environment: { node: string; platform: string; release: string; arch: string };
}
export interface ConsumerSelection {
    runId: string;
    engineSha256: string;
    engineFilename: string;
    consumer: ConsumerManifest["consumer"];
}
export function readConsumerManifest(value: unknown): ConsumerManifest {
    const h = readHeader(value, "consumer-manifest"),
        v = object(value);
    if (v.contractVersion !== 1) throw Error("Unsupported consumer contract version");
    const p = object(v.package),
        c = object(v.consumer),
        e = object(v.environment);
    const filename = string(p.filename);
    if (!/^[^/\\:]+\.tgz$/.test(filename) || filename.includes("\0"))
        throw Error("Invalid package filename");
    const path = string(p.path);
    if (path !== `package/${filename}`) throw Error("Invalid retained package path");
    return {
        ...h,
        contractVersion: 1,
        package: { filename, path, sha256: sha(p.sha256) },
        installed: files(v.installed),
        consumer: { revision: string(c.revision), source: files(c.source), lock: files(c.lock) },
        environment: {
            node: string(e.node),
            platform: string(e.platform),
            release: string(e.release),
            arch: string(e.arch),
        },
    };
}
function same(a: Identities, b: Identities): boolean {
    return (
        Object.keys(a).length === Object.keys(b).length &&
        Object.entries(a).every(([k, v]) => b[k] === v)
    );
}
/** Call even after nonzero exit. Invalid responses throw; valid failed responses retain failures. */
export function validateConsumerResponse(
    output: string,
    selected: ConsumerSelection,
    exitCode: number,
) {
    const root = contained(output, "evidence");
    const read = (path: string): unknown => JSON.parse(readFileSync(contained(root, path), "utf8"));
    const manifest = readConsumerManifest(read("manifest.json"));
    const result = readResult(read("result.json"));
    const artifacts = readArtifacts(read("artifacts.json"));
    if ([manifest, result, artifacts].some((d) => d.runId !== selected.runId))
        throw Error("Cross-document run ID mismatch");
    if (
        manifest.package.sha256 !== sha(selected.engineSha256) ||
        manifest.package.filename !== selected.engineFilename
    )
        throw Error("Selected package mismatch");
    if (
        manifest.consumer.revision !== selected.consumer.revision ||
        !same(manifest.consumer.source, selected.consumer.source) ||
        !same(manifest.consumer.lock, selected.consumer.lock)
    )
        throw Error("Selected consumer mismatch");
    if (
        result.evidence !== "complete" ||
        !["completed", "failed", "interrupted"].includes(result.execution) ||
        result.cleanup === "pending" ||
        !result.stages.some((s) => s.required)
    )
        throw Error("Incomplete consumer result");
    if (![0, 1].includes(exitCode) || (exitCode === 0) !== result.accepted)
        throw Error("Exit/outcome mismatch");
    const actual = identities(root);
    delete actual["artifacts.json"];
    const expected = Object.fromEntries(artifacts.files.map((f) => [f.path, f.sha256]));
    if (!same(actual, expected)) throw Error("Artifact inventory mismatch");
    for (const required of ["manifest.json", "result.json", "report.md", manifest.package.path])
        if (!(required in expected)) throw Error(`Missing required artifact: ${required}`);
    for (const f of artifacts.files)
        if (readFileSync(contained(root, f.path)).length !== f.bytes)
            throw Error(`Artifact size mismatch: ${f.path}`);
    for (const f of artifacts.files) {
        const match = /^stages\/[^/]+\/(observations|measurements)\.json$/.exec(f.path);
        if (match && readHeader(read(f.path), match[1]).runId !== selected.runId)
            throw Error("Stage document run ID mismatch");
    }
    if (hash(readFileSync(contained(root, manifest.package.path))) !== manifest.package.sha256)
        throw Error("Retained package hash mismatch");
    return { manifest, result, artifacts, accepted: result.accepted };
}
/** Include transitive schema/identity inputs, not only the validator entry point. */
export function consumerValidatorIdentity(repository: string) {
    return {
        files: Object.fromEntries(
            ["consumer-contract-v1.ts", "schema.ts", "identity.ts"].map((p) => [
                p,
                hash(readFileSync(join(repository, "tooling/evidence", p))),
            ]),
        ),
        fixtures: identities(join(repository, "tooling/tests/fixtures/consumer-contract-v1")),
    };
}
