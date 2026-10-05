import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { contained, hash, identities } from "../evidence/identity.js";
import { header, object, string } from "../evidence/schema.js";

const repository = "that-webdev-dude/ngne";
const repositoryURL = `https://github.com/${repository}`;
const registry = "https://registry.npmjs.org/";
const workflow = ".github/workflows/publish-release.yml";
const environment = "npm-publication";
const output = "out/publication";
const candidateDirectory = `${output}/candidate`;
const json = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const digest = (algorithm: string, bytes: Buffer, encoding: "hex" | "base64" = "hex") =>
    createHash(algorithm).update(bytes).digest(encoding);
const positive = (value: unknown): string => {
    const result = String(value);
    assert.match(result, /^[1-9][0-9]*$/);
    assert(Number.isSafeInteger(Number(result)), "Invalid numeric identity");
    return result;
};

export function validateSelection(
    latest: unknown,
    attempt: unknown,
    artifact: unknown,
    runId: string,
    runAttempt: string,
    publishingSHA: string,
) {
    positive(runId);
    positive(runAttempt);
    assert.match(publishingSHA, /^[a-f0-9]{40}$/);
    const run = object(attempt),
        current = object(latest),
        item = object(artifact);
    for (const record of [run, current]) {
        assert.equal(String(record.id), runId);
        assert.equal(String(record.run_attempt), runAttempt, "Select the latest candidate attempt");
        assert.equal(record.status, "completed");
        assert.equal(record.conclusion, "success");
        assert.equal(record.event, "workflow_dispatch");
        assert.equal(record.path, ".github/workflows/release-candidate.yml");
        assert.equal(object(record.repository).full_name, repository);
        assert.equal(object(record.head_repository).full_name, repository);
        assert.equal(
            record.head_sha,
            publishingSHA,
            "Publishing GITHUB_SHA must equal candidate SHA",
        );
    }
    const owner = object(item.workflow_run);
    positive(item.id);
    assert.equal(item.name, `release-candidate-${runId}-${runAttempt}`);
    assert.equal(item.expired, false);
    assert.equal(String(owner.id), runId);
    assert.equal(owner.head_sha, publishingSHA);
    assert.equal(owner.repository_id, object(run.repository).id);
    assert.equal(owner.head_repository_id, object(run.head_repository).id);
    assert.match(string(item.digest), /^sha256:[a-f0-9]{64}$/);
    return {
        runId,
        runAttempt,
        sourceSHA: publishingSHA,
        artifactId: positive(item.id),
        artifactDigest: string(item.digest),
    };
}

export function validateProtection(value: unknown): number {
    const config = object(value);
    assert.equal(config.name, environment);
    assert.equal(config.can_admins_bypass, false, "Disable environment protection bypass");
    assert(Array.isArray(config.protection_rules));
    const reviewers = config.protection_rules
        .map(object)
        .find((rule) => rule.type === "required_reviewers");
    assert(
        reviewers && Array.isArray(reviewers.reviewers) && reviewers.reviewers.length > 0,
        "Configure required environment reviewers before publication",
    );
    assert(typeof config.id === "number");
    return config.id;
}

export function validateApproval(value: unknown, environmentId: number): void {
    assert(Array.isArray(value));
    const reviews = value
        .map(object)
        .filter(
            (review) =>
                Array.isArray(review.environments) &&
                review.environments.map(object).some((env) => env.id === environmentId),
        );
    assert(
        reviews.some((review) => review.state === "approved"),
        "Explicit environment approval is missing",
    );
    assert(
        !reviews.some((review) => review.state === "rejected"),
        "Rejected publication needs a fresh dispatch",
    );
}

export function validateCandidate(
    directory: string,
    selection: ReturnType<typeof validateSelection>,
    approvedHash?: string,
) {
    const bytes = readFileSync(contained(directory, "candidate.json"));
    if (approvedHash) assert.equal(hash(bytes), approvedHash, "Candidate changed after review");
    const candidate = object(JSON.parse(bytes.toString("utf8")));
    const version = string(candidate.version);
    assert.match(
        version,
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    );
    const filename = `ngne-core-${version}.tgz`;
    assert.equal(candidate.name, "@ngne/core");
    assert.equal(candidate.sourceSHA, selection.sourceSHA);
    assert.equal(candidate.workflowRun, `${repositoryURL}/actions/runs/${selection.runId}`);
    assert.equal(String(candidate.runAttempt), selection.runAttempt);
    assert.equal(candidate.verification, "workflow-checks-passed");
    assert.equal(candidate.publicationApproved, false);
    assert.equal(candidate.intendedTag, `v${version}`);
    assert.equal(
        candidate.evidenceArtifact,
        `release-diagnostics-${selection.runId}-${selection.runAttempt}`,
    );
    assert.equal(candidate.tarball, filename);
    const config = object(candidate.publishConfig),
        channel = version.includes("-") ? "next" : "latest";
    assert.equal(config.registry, registry);
    assert.equal(config.access, "public");
    assert.equal(config.tag, channel);
    assert.deepEqual(
        readdirSync(directory).sort(),
        [filename, "candidate.json", "manifest.json", "SHA256SUMS"].sort(),
    );
    const expectedSums =
        [filename, "manifest.json", "candidate.json"]
            .map((file) => `${hash(readFileSync(contained(directory, file)))}  ${file}`)
            .join("\n") + "\n";
    assert.equal(readFileSync(contained(directory, "SHA256SUMS"), "utf8"), expectedSums);
    const archive = readFileSync(contained(directory, filename));
    assert.equal(hash(archive), candidate.tarballSHA256);
    assert.equal(
        hash(readFileSync(contained(directory, "manifest.json"))),
        candidate.manifestSHA256,
    );
    const manifest = object(json(contained(directory, "manifest.json")));
    assert.equal(manifest.format, "ngne-tooling");
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.documentType, "manifest");
    assert.equal(manifest.suite, "package");
    assert.equal(manifest.preparation, "prepared");
    assert.equal(manifest.runId, candidate.preparationRunId);
    assert.equal(object(manifest.provenance).revision, selection.sourceSHA);
    assert.equal(object(manifest.provenance).changes, "");
    const prepared = object(manifest.prepared),
        pkg = object(prepared.package);
    assert.equal(pkg.filename, filename);
    assert.equal(pkg.sha256, candidate.tarballSHA256);
    return {
        name: string(candidate.name),
        version,
        channel,
        tag: `v${version}`,
        filename,
        sourceSHA: selection.sourceSHA,
        sha256: hash(archive),
        sha512: digest("sha512", archive),
        integrity: `sha512-${digest("sha512", archive, "base64")}`,
        shasum: digest("sha1", archive),
        candidateHash: hash(bytes),
        files: object(pkg.files),
        limits: string(candidate.limits),
    };
}
type Candidate = ReturnType<typeof validateCandidate>;

export function registryVersion(
    packument: unknown,
    candidate: Candidate,
): Record<string, unknown> | null {
    const pkg = object(packument);
    assert.equal(pkg.name, candidate.name);
    const versions = object(pkg.versions);
    // ponytail: only a successful package response proves absence; every HTTP error fails closed.
    if (!Object.hasOwn(versions, candidate.version)) {
        assert(
            !pkg.time || !Object.hasOwn(object(pkg.time), candidate.version),
            "Previously unpublished version cannot be reused",
        );
        return null;
    }
    const version = object(versions[candidate.version]),
        dist = object(version.dist);
    assert.equal(version.name, candidate.name);
    assert.equal(version.version, candidate.version);
    assert.equal(
        dist.integrity,
        candidate.integrity,
        "Existing version has different bytes; use a new version",
    );
    assert.equal(dist.shasum, candidate.shasum);
    return version;
}

export function validateProvenance(
    statement: unknown,
    candidate: Candidate,
): { runId: string; runAttempt: string; ref: string } {
    const s = object(statement);
    assert.equal(s._type, "https://in-toto.io/Statement/v1");
    assert.equal(s.predicateType, "https://slsa.dev/provenance/v1");
    assert(Array.isArray(s.subject) && s.subject.length === 1);
    const subject = object(s.subject[0]);
    assert.equal(
        subject.name,
        `pkg:npm/${encodeURIComponent(candidate.name).replace(/%2F/g, "/")}@${candidate.version}`,
    );
    assert.equal(object(subject.digest).sha512, candidate.sha512);
    const predicate = object(s.predicate),
        definition = object(predicate.buildDefinition);
    assert.equal(
        definition.buildType,
        "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
    );
    const source = object(object(definition.externalParameters).workflow);
    assert.equal(source.repository, repositoryURL);
    assert.equal(source.path, workflow);
    assert.equal(source.ref, "refs/heads/main");
    assert(
        Array.isArray(definition.resolvedDependencies) &&
            definition.resolvedDependencies.length === 1,
    );
    const dependency = object(definition.resolvedDependencies[0]);
    assert.equal(dependency.uri, `git+${repositoryURL}@${source.ref}`);
    assert.equal(
        object(dependency.digest).gitCommit,
        candidate.sourceSHA,
        "Provenance source differs from candidate",
    );
    const details = object(predicate.runDetails);
    assert.equal(object(details.builder).id, "https://github.com/actions/runner/github-hosted");
    const invocation = string(object(details.metadata).invocationId);
    assert(invocation.startsWith(`${repositoryURL}/actions/runs/`));
    const match = invocation
        .slice(`${repositoryURL}/actions/runs/`.length)
        .match(/^([1-9]\d*)\/attempts\/([1-9]\d*)$/);
    assert(match, "Unexpected provenance invocation");
    return { runId: positive(match[1]), runAttempt: positive(match[2]), ref: string(source.ref) };
}

export function validateTag(
    commit: string | null,
    candidateSHA: string,
    mustExist = false,
): "create" | "existing" {
    if (commit === null) {
        assert(!mustExist, "Release tag is missing");
        return "create";
    }
    assert.equal(commit, candidateSHA, "Release tag points elsewhere; never overwrite it");
    return "existing";
}

export function tagCommit(refs: string, tag: string): string | null {
    if (!refs.trim()) return null;
    const values = new Map(
        refs
            .trim()
            .split(/\r?\n/)
            .map((line) => {
                const [sha, ref] = line.split(/\s+/);
                return [ref, sha];
            }),
    );
    // Existing matching tags may be lightweight; newly created tags are annotated.
    return (
        values.get(`refs/tags/${tag}^{}`) ??
        values.get(`refs/tags/${tag}`) ??
        assert.fail("Unexpected tag response")
    );
}

export function validateInvocation(
    origin: { runId: string; runAttempt: string },
    runId: string,
    runAttempt: string,
    exactAttempt: boolean,
) {
    assert.equal(origin.runId, runId);
    if (exactAttempt) assert.equal(origin.runAttempt, runAttempt);
    else
        assert(
            Number(positive(origin.runAttempt)) <= Number(positive(runAttempt)),
            "Provenance comes from a future attempt",
        );
}

export async function request(url: string, options: RequestInit = {}): Promise<unknown> {
    const response = await fetch(url, {
        redirect: "error",
        ...options,
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
    return response.json();
}
async function github(endpoint: string, method = "GET", body?: unknown): Promise<unknown> {
    assert(process.env.GH_TOKEN, "Missing workflow GitHub token");
    return request(`https://api.github.com/repos/${repository}/${endpoint}`, {
        method,
        headers: {
            Authorization: `Bearer ${process.env.GH_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}
const npm = (args: string[], cwd = process.cwd()): string =>
    execFileSync("npm", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 180_000,
    });
const save = (file: string, value: unknown) =>
    writeFileSync(`${output}/${file}`, JSON.stringify(value, null, 2) + "\n");

export function publicationInventory(directory: string, finalResult: string) {
    // Only inventory retained evidence; installed executables contain npm-created symlinks.
    const files = readdirSync(directory).filter(
        (file) =>
            file !== "artifacts.json" && (/\.(json|log)$/.test(file) || file === "registry.tgz"),
    );
    files.push("smoke/package.json", "smoke/package-lock.json");
    return files.sort().map((file) => {
        const bytes =
            file === "result.json"
                ? Buffer.from(finalResult)
                : readFileSync(contained(directory, file));
        return { path: file, sha256: hash(bytes), bytes: bytes.length };
    });
}
const stepOutput = (key: string, value: string) => {
    assert(!/[\r\n]/.test(value));
    assert(process.env.GITHUB_OUTPUT);
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};
const packument = () =>
    request(`${registry}${encodeURIComponent("@ngne/core")}`, {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });

export async function publishOnce(
    candidate: Candidate,
    probe: () => Promise<unknown>,
    send: () => void,
) {
    if (registryVersion(await probe(), candidate))
        return { attempted: false, commandSucceeded: false };
    try {
        send();
        return { attempted: true, commandSucceeded: true };
    } catch {
        return { attempted: true, commandSucceeded: false };
    }
}

export function validateArchive(bytes: Buffer, expectedDigest: string): void {
    assert.equal(
        `sha256:${hash(bytes)}`,
        expectedDigest,
        "GitHub artifact archive digest mismatch",
    );
}

async function download(selection: ReturnType<typeof validateSelection>) {
    const response = await fetch(
        `https://api.github.com/repos/${repository}/actions/artifacts/${selection.artifactId}/zip`,
        {
            headers: {
                Authorization: `Bearer ${process.env.GH_TOKEN}`,
                Accept: "application/vnd.github+json",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(30_000),
        },
    );
    assert(response.ok, `Candidate download HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    validateArchive(bytes, selection.artifactDigest);
    const zip = `${output}/candidate.zip`;
    writeFileSync(zip, bytes);
    const members = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split(/\r?\n/);
    assert.equal(members.length, 4);
    assert.equal(new Set(members).size, 4);
    for (const member of members)
        assert(
            /^(candidate\.json|manifest\.json|SHA256SUMS|ngne-core-[0-9A-Za-z.-]+\.tgz)$/.test(
                member,
            ),
            "Unsafe artifact entry",
        );
    mkdirSync(candidateDirectory);
    execFileSync("unzip", ["-q", zip, "-d", candidateDirectory]);
}

async function select() {
    assert.equal(process.env.GITHUB_REPOSITORY, repository);
    assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
    assert.equal(process.env.GITHUB_REF, "refs/heads/main");
    assert.equal(process.env.GITHUB_WORKFLOW_REF, `${repository}/${workflow}@refs/heads/main`);
    const sha = string(process.env.GITHUB_SHA);
    assert.equal(process.env.GITHUB_WORKFLOW_SHA, sha);
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sha);
    const runId = positive(process.env.CANDIDATE_RUN_ID),
        runAttempt = positive(process.env.CANDIDATE_RUN_ATTEMPT);
    const latest = await github(`actions/runs/${runId}`),
        attempt = await github(`actions/runs/${runId}/attempts/${runAttempt}`);
    const artifacts: unknown[] = [];
    for (let page = 1; ; page++) {
        const listing = object(
            await github(`actions/runs/${runId}/artifacts?per_page=100&page=${page}`),
        );
        assert(Array.isArray(listing.artifacts));
        artifacts.push(...listing.artifacts);
        if (listing.artifacts.length < 100) break;
    }
    const matches = artifacts
        .map(object)
        .filter((item) => item.name === `release-candidate-${runId}-${runAttempt}`);
    assert.equal(matches.length, 1, "Missing or ambiguous candidate artifact");
    const selection = validateSelection(latest, attempt, matches[0], runId, runAttempt, sha);
    validateProtection(await github(`environments/${environment}`));
    if (process.env.REVIEWED_ARTIFACT_ID) {
        assert.equal(selection.artifactId, process.env.REVIEWED_ARTIFACT_ID);
        assert.equal(selection.artifactDigest, process.env.REVIEWED_ARTIFACT_DIGEST);
    }
    save("selection.json", selection);
    stepOutput("artifact_id", selection.artifactId);
    stepOutput("artifact_digest", selection.artifactDigest);
    return selection;
}

async function inspect(selection: ReturnType<typeof validateSelection>) {
    const candidate = validateCandidate(
        candidateDirectory,
        selection,
        process.env.REVIEWED_CANDIDATE_HASH,
    );
    const archive = path.join(candidateDirectory, candidate.filename);
    const packedBytes = execFileSync("tar", ["-xOf", archive, "package/package.json"]);
    const packed = object(JSON.parse(packedBytes.toString("utf8")));
    const sourceBytes = execFileSync("git", ["show", `${selection.sourceSHA}:package.json`]);
    assert.equal(hash(sourceBytes), candidate.files["package.json"]);
    assert.equal(
        hash(sourceBytes),
        hash(packedBytes),
        "Packed package metadata differs from source",
    );
    const lock = object(
        JSON.parse(
            execFileSync("git", ["show", `${selection.sourceSHA}:package-lock.json`], {
                encoding: "utf8",
            }),
        ),
    );
    assert.equal(lock.name, candidate.name);
    assert.equal(lock.version, candidate.version);
    assert.equal(object(object(lock.packages)[""]).name, candidate.name);
    assert.equal(object(object(lock.packages)[""]).version, candidate.version);
    assert.equal(packed.name, candidate.name);
    assert.equal(packed.version, candidate.version);
    assert.notEqual(packed.private, true);
    assert.equal(object(packed.repository).url, `${repositoryURL}.git`);
    assert.deepEqual(packed.publishConfig, { registry, access: "public", tag: candidate.channel });
    return candidate;
}

async function remoteTag(candidate: Candidate): Promise<string | null> {
    // ls-remote distinguishes absence (successful empty response) from Git/network errors.
    const refs = execFileSync(
        "git",
        [
            "ls-remote",
            "--tags",
            `${repositoryURL}.git`,
            `refs/tags/${candidate.tag}`,
            `refs/tags/${candidate.tag}^{}`,
        ],
        { encoding: "utf8", timeout: 30_000 },
    ).trim();
    return tagCommit(refs, candidate.tag);
}

function provenanceVerifier() {
    const require = createRequire(path.join(npm(["root", "-g"]).trim(), "npm/package.json"));
    const verifier = require("sigstore").verify;
    assert.equal(typeof verifier, "function", "npm's provenance verifier is unavailable");
    return verifier;
}

async function verifyRegistry(
    candidate: Candidate,
    document: unknown,
    publication?: { attempted: boolean; commandSucceeded: boolean },
) {
    const version = registryVersion(document, candidate);
    assert(version, "Exact version is absent; do not retry publication within this attempt");
    assert.equal(
        object(object(document)["dist-tags"])[candidate.channel],
        candidate.version,
        "Distribution tag differs; authorize correction separately",
    );
    const dist = object(version.dist);
    const registryURL = (value: unknown) => {
        const url = new URL(string(value));
        assert.equal(url.origin, new URL(registry).origin);
        assert.equal(url.username + url.password, "");
        return url.href;
    };
    const response = await fetch(registryURL(dist.tarball), {
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
    });
    assert(response.ok, `Registry archive HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(hash(bytes), candidate.sha256, "Registry archive differs");
    writeFileSync(`${output}/registry.tgz`, bytes);
    const attestations = await request(registryURL(object(dist.attestations).url));
    save("attestations.json", attestations);
    const entries = object(attestations).attestations;
    assert(Array.isArray(entries));
    const provenance = entries
        .map(object)
        .filter((entry) => entry.predicateType === "https://slsa.dev/provenance/v1");
    assert.equal(provenance.length, 1, "Missing or ambiguous npm provenance");
    const bundle = object(provenance[0].bundle);
    const statement: unknown = JSON.parse(
        Buffer.from(string(object(bundle.dsseEnvelope).payload), "base64").toString("utf8"),
    );
    const origin = validateProvenance(statement, candidate);
    if (publication?.attempted) {
        validateInvocation(
            origin,
            string(process.env.GITHUB_RUN_ID),
            string(process.env.GITHUB_RUN_ATTEMPT),
            publication.commandSucceeded,
        );
    }
    // Reuse npm's installed verifier; decoding a statement alone is not verification.
    await provenanceVerifier()(bundle, {
        certificateIssuer: "https://token.actions.githubusercontent.com",
        certificateIdentityURI: `${repositoryURL}/${workflow}@${origin.ref}`,
    });
    const publishingRun = object(
        await github(`actions/runs/${origin.runId}/attempts/${origin.runAttempt}`),
    );
    assert.equal(publishingRun.head_sha, candidate.sourceSHA);
    assert.equal(publishingRun.path, workflow);
    assert.equal(publishingRun.event, "workflow_dispatch");
    assert.equal(object(publishingRun.repository).full_name, repository);
    assert.equal(object(publishingRun.head_repository).full_name, repository);
    return origin;
}

async function publish(selection: ReturnType<typeof validateSelection>, candidate: Candidate) {
    assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
    assert(
        process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
        "OIDC permission missing",
    );
    assert(
        !process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN,
        "Long-lived npm credentials are forbidden",
    );
    const environmentId = validateProtection(await github(`environments/${environment}`));
    validateApproval(
        await github(`actions/runs/${positive(process.env.GITHUB_RUN_ID)}/approvals`),
        environmentId,
    );
    const [major, minor, patch] = npm(["--version"]).trim().split(".").map(Number);
    assert(
        major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1))),
        "npm 11.5.1+ required",
    );
    provenanceVerifier(); // Resolve the existing verifier before any tag or upload.
    let document = await packument();
    const existing = registryVersion(document, candidate);
    if (existing) await verifyRegistry(candidate, document);
    const tagState = validateTag(await remoteTag(candidate), candidate.sourceSHA);
    // Re-read bytes and packed metadata immediately before either irreversible action.
    assert.deepEqual(await inspect(selection), candidate);
    if (tagState === "create") {
        const tag = object(
            await github("git/tags", "POST", {
                tag: candidate.tag,
                message: `Release ${candidate.name}@${candidate.version}\nCandidate SHA-256: ${candidate.sha256}\n`,
                object: candidate.sourceSHA,
                type: "commit",
                tagger: {
                    name: "github-actions[bot]",
                    email: "41898282+github-actions[bot]@users.noreply.github.com",
                    date: new Date().toISOString(),
                },
            }),
        );
        try {
            await github("git/refs", "POST", {
                ref: `refs/tags/${candidate.tag}`,
                sha: string(tag.sha),
            });
        } catch (error) {
            if (validateTag(await remoteTag(candidate), candidate.sourceSHA) !== "existing")
                throw error;
        }
    }
    validateTag(await remoteTag(candidate), candidate.sourceSHA, true);
    assert.deepEqual(await inspect(selection), candidate);
    const publication = await publishOnce(candidate, packument, () => {
        try {
            writeFileSync(
                `${output}/publish.log`,
                npm([
                    "publish",
                    path.resolve(candidateDirectory, candidate.filename),
                    "--registry",
                    registry,
                    "--access",
                    "public",
                    "--tag",
                    candidate.channel,
                    "--provenance",
                    "--ignore-scripts",
                ]),
            );
        } catch (error) {
            writeFileSync(`${output}/publish.log`, String(error));
            throw error;
        }
    });
    save("publish-attempt.json", publication);
    let origin: Awaited<ReturnType<typeof verifyRegistry>> | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            document = await packument();
            origin = await verifyRegistry(candidate, document, publication);
            break;
        } catch (error) {
            save("registry-failure.json", { attempt, error: String(error) });
            if (attempt === 4) throw error;
            await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
        }
    }
    save("registry.json", document);
    const smoke = `${output}/smoke`;
    mkdirSync(smoke); // Fresh workspace and cache; never reuse an earlier installation.
    writeFileSync(
        `${smoke}/package.json`,
        JSON.stringify({
            name: "ngne-registry-smoke",
            version: "1.0.0",
            private: true,
            type: "module",
        }),
    );
    const cache = path.resolve(output, "npm-cache");
    writeFileSync(
        `${output}/install.log`,
        npm(
            [
                "install",
                "--save-exact",
                `${candidate.name}@${candidate.version}`,
                "--registry",
                registry,
                "--cache",
                cache,
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
            ],
            path.resolve(smoke),
        ),
    );
    const locked = object(
        object(object(json(`${smoke}/package-lock.json`)).packages)[
            `node_modules/${candidate.name}`
        ],
    );
    assert.equal(locked.version, candidate.version);
    assert.equal(locked.integrity, candidate.integrity);
    assert.equal(locked.resolved, object(registryVersion(document, candidate)!.dist).tarball);
    assert.deepEqual(identities(`${smoke}/node_modules/${candidate.name}`), candidate.files);
    writeFileSync(
        `${output}/import.log`,
        execFileSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                `const engine = await import('${candidate.name}'); if (!Object.keys(engine).length) throw Error('Empty engine exports');`,
            ],
            {
                cwd: path.resolve(smoke),
                encoding: "utf8",
                timeout: 30_000,
                env: { PATH: process.env.PATH },
            },
        ),
    );
    writeFileSync(
        `${output}/signatures.log`,
        npm(["audit", "signatures", "--registry", registry, "--cache", cache], path.resolve(smoke)),
    );
    assert.deepEqual(await inspect(selection), candidate);
    validateTag(await remoteTag(candidate), candidate.sourceSHA, true);
    assert.equal(
        object(object(await packument())["dist-tags"])[candidate.channel],
        candidate.version,
    );
    return {
        publication: publication.attempted
            ? publication.commandSucceeded
                ? "published"
                : "reconciled"
            : "existing",
        provenance: origin,
        tag: tagState,
        install: "passed",
    };
}

async function main() {
    mkdirSync(output, { recursive: true });
    const mode = process.argv[2];
    assert(
        ["select", "download", "review", "publish"].includes(mode),
        "Use select, download, review or publish",
    );
    if (mode === "select") {
        await select();
        return;
    }
    const selection = await select();
    if (mode === "download") {
        await download(selection);
        return;
    }
    const candidate = await inspect(selection);
    if (mode === "review") {
        const version = registryVersion(await packument(), candidate);
        if (version)
            assert(
                object(version.dist).attestations,
                "Version already exists without npm provenance; select a new version",
            );
        validateTag(await remoteTag(candidate), candidate.sourceSHA);
        stepOutput("candidate_hash", candidate.candidateHash);
        const summary = `Package: ${candidate.name}@${candidate.version}\n\nSource: ${candidate.sourceSHA}\n\nTag: ${candidate.tag}; npm channel: ${candidate.channel}\n\nTarball SHA-256: ${candidate.sha256}\n\nCandidate: ${repositoryURL}/actions/runs/${selection.runId}/attempts/${selection.runAttempt}; artifact ${selection.artifactId} (${selection.artifactDigest})\n\nRegistry version: ${version ? "already exists; full identity/provenance verification required" : "absent"}\n\nEvidence: release-diagnostics-${selection.runId}-${selection.runAttempt}\n\n${candidate.limits}\n\nReview package contents and existing evidence, then approve the npm-publication environment to authorize the tag and publication.\n`;
        writeFileSync(`${output}/review.md`, summary);
        appendFileSync(string(process.env.GITHUB_STEP_SUMMARY), summary);
        return;
    }
    assert(
        process.env.REVIEWED_ARTIFACT_ID &&
            process.env.REVIEWED_ARTIFACT_DIGEST &&
            process.env.REVIEWED_CANDIDATE_HASH,
        "Review outputs are required",
    );
    save("result.json", {
        ...header("publication", string(process.env.GITHUB_RUN_ID)),
        accepted: false,
    });
    const result = await publish(selection, candidate);
    const finalResult =
        JSON.stringify(
            {
                ...header("publication", string(process.env.GITHUB_RUN_ID)),
                accepted: true,
                selection,
                candidate,
                ...result,
            },
            null,
            2,
        ) + "\n";
    save("artifacts.json", {
        ...header("artifacts", string(process.env.GITHUB_RUN_ID)),
        files: publicationInventory(output, finalResult),
    });
    appendFileSync(
        string(process.env.GITHUB_STEP_SUMMARY),
        `Verified ${candidate.name}@${candidate.version}: ${result.publication}; ${candidate.tag}; ${candidate.channel}; source ${candidate.sourceSHA}; SHA-256 ${candidate.sha256}. Registry archive, signed provenance and isolated install passed.\n`,
    );
    // Match the existing run owner: acceptance is written last, after evidence publication.
    writeFileSync(`${output}/result.json`, finalResult);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
    main().catch((error) => {
        mkdirSync(output, { recursive: true });
        save("failure.json", { accepted: false, error: String(error) });
        console.error(error);
        process.exitCode = 1;
    });
