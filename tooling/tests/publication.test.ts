import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
    publishOnce,
    publicationInventory,
    registryVersion,
    request,
    validateApproval,
    validateArchive,
    validateInvocation,
    validateCandidate,
    validateProtection,
    validateProvenance,
    validateSelection,
    validateTag,
    tagCommit,
} from "../commands/publish.js";
import { hash } from "../evidence/identity.js";
import { object } from "../evidence/schema.js";

const repository = "that-webdev-dude/ngne",
    sha = "a".repeat(40);
function selectionFixture() {
    const run = {
        id: 123,
        run_attempt: 2,
        status: "completed",
        conclusion: "success",
        event: "workflow_dispatch",
        path: ".github/workflows/release-candidate.yml",
        head_sha: sha,
        repository: { id: 456, full_name: repository },
        head_repository: { id: 456, full_name: repository },
    };
    const artifact = {
        id: 789,
        name: "release-candidate-123-2",
        expired: false,
        digest: `sha256:${"b".repeat(64)}`,
        workflow_run: { id: 123, head_sha: sha, repository_id: 456, head_repository_id: 456 },
    };
    return { latest: structuredClone(run), run, artifact };
}
function select(f = selectionFixture(), sourceSHA = sha) {
    return validateSelection(f.latest, f.run, f.artifact, "123", "2", sourceSHA);
}
function candidateFixture(t: test.TestContext, version = "0.2.0-alpha.2") {
    mkdirSync(".test-output", { recursive: true });
    const directory = mkdtempSync(path.resolve(".test-output/publication-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const bytes = Buffer.from("retained candidate, never repacked"),
        filename = `ngne-core-${version}.tgz`;
    const manifest = {
        format: "ngne-tooling",
        schemaVersion: 1,
        documentType: "manifest",
        suite: "package",
        preparation: "prepared",
        runId: "fixture",
        provenance: { revision: sha, changes: "" },
        prepared: {
            package: { filename, sha256: hash(bytes), files: { "package.json": hash("metadata") } },
        },
    };
    const candidate = {
        name: "@ngne/core",
        version,
        publishConfig: {
            registry: "https://registry.npmjs.org/",
            access: "public",
            tag: version.includes("-") ? "next" : "latest",
        },
        sourceSHA: sha,
        workflowRun: `https://github.com/${repository}/actions/runs/123`,
        runAttempt: "2",
        verification: "workflow-checks-passed",
        publicationApproved: false,
        intendedTag: `v${version}`,
        evidenceArtifact: "release-diagnostics-123-2",
        tarball: filename,
        tarballSHA256: hash(bytes),
        manifestSHA256: "",
        preparationRunId: "fixture",
        limits: "Synthetic tooling evidence only",
    };
    const write = () => {
        writeFileSync(path.join(directory, filename), bytes);
        writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest));
        candidate.manifestSHA256 = hash(readFileSync(path.join(directory, "manifest.json")));
        writeFileSync(path.join(directory, "candidate.json"), JSON.stringify(candidate));
        writeFileSync(
            path.join(directory, "SHA256SUMS"),
            [filename, "manifest.json", "candidate.json"]
                .map((file) => `${hash(readFileSync(path.join(directory, file)))}  ${file}`)
                .join("\n") + "\n",
        );
    };
    write();
    return {
        directory,
        candidate,
        manifest,
        write,
        read: () => validateCandidate(directory, select()),
    };
}
function registry(candidate: ReturnType<typeof validateCandidate>, present = true) {
    return {
        name: candidate.name,
        versions: present
            ? {
                  [candidate.version]: {
                      name: candidate.name,
                      version: candidate.version,
                      dist: { integrity: candidate.integrity, shasum: candidate.shasum },
                  },
              }
            : {},
        "dist-tags": { [candidate.channel]: candidate.version },
    };
}
function provenance(candidate: ReturnType<typeof validateCandidate>) {
    return {
        _type: "https://in-toto.io/Statement/v1",
        predicateType: "https://slsa.dev/provenance/v1",
        subject: [
            {
                name: `pkg:npm/%40ngne/core@${candidate.version}`,
                digest: { sha512: candidate.sha512 },
            },
        ],
        predicate: {
            buildDefinition: {
                buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
                externalParameters: {
                    workflow: {
                        repository: `https://github.com/${repository}`,
                        path: ".github/workflows/publish-release.yml",
                        ref: "refs/heads/main",
                    },
                },
                resolvedDependencies: [
                    {
                        uri: `git+https://github.com/${repository}@refs/heads/main`,
                        digest: { gitCommit: sha },
                    },
                ],
            },
            runDetails: {
                builder: { id: "https://github.com/actions/runner/github-hosted" },
                metadata: {
                    invocationId: `https://github.com/${repository}/actions/runs/321/attempts/1`,
                },
            },
        },
    };
}

test("candidate selection binds successful latest attempt, repository, SHA and exact artifact", () => {
    assert.equal(select().artifactId, "789");
    const mutations: ((f: ReturnType<typeof selectionFixture>) => void)[] = [
        (f) => {
            f.run.id++;
        },
        (f) => {
            f.latest.run_attempt++;
        },
        (f) => {
            f.run.run_attempt--;
        },
        (f) => {
            f.latest.status = "in_progress";
        },
        (f) => {
            f.run.conclusion = "failure";
        },
        (f) => {
            f.run.path = ".github/workflows/ci.yml";
        },
        (f) => {
            f.run.event = "pull_request";
        },
        (f) => {
            f.run.repository.full_name = "fork/ngne";
        },
        (f) => {
            f.run.head_repository.full_name = "fork/ngne";
        },
        (f) => {
            f.run.head_sha = "c".repeat(40);
        },
        (f) => {
            f.artifact.workflow_run.id++;
        },
        (f) => {
            f.artifact.workflow_run.repository_id++;
        },
        (f) => {
            f.artifact.workflow_run.head_repository_id++;
        },
        (f) => {
            f.artifact.workflow_run.head_sha = "c".repeat(40);
        },
        (f) => {
            f.artifact.name = "release-candidate-123-1";
        },
        (f) => {
            f.artifact.expired = true;
        },
        (f) => {
            f.artifact.digest = "";
        },
        (f) => {
            f.artifact.id = 0;
        },
    ];
    for (const mutate of mutations) {
        const f = selectionFixture();
        mutate(f);
        assert.throws(() => select(f));
    }
    assert.throws(() => select(selectionFixture(), "d".repeat(40)), /GITHUB_SHA/);
});

test("missing protection, approval or an archive digest mismatch fails closed", () => {
    const config = {
        id: 7,
        name: "npm-publication",
        can_admins_bypass: false,
        protection_rules: [
            { type: "required_reviewers", reviewers: [{ type: "User", reviewer: { id: 8 } }] },
        ],
    };
    assert.equal(validateProtection(config), 7);
    assert.throws(() => validateProtection({ ...config, can_admins_bypass: true }));
    assert.throws(() => validateProtection({ ...config, protection_rules: [] }));
    assert.throws(() =>
        validateProtection({
            ...config,
            protection_rules: [{ type: "required_reviewers", reviewers: [] }],
        }),
    );
    validateApproval([{ state: "approved", environments: [{ id: 7 }] }], 7);
    for (const reviews of [
        [],
        [{ state: "approved", environments: [{ id: 9 }] }],
        [{ state: "rejected", environments: [{ id: 7 }] }],
    ])
        assert.throws(() => validateApproval(reviews, 7));
    validateArchive(Buffer.from("zip"), `sha256:${hash("zip")}`);
    assert.throws(() => validateArchive(Buffer.from("changed"), `sha256:${hash("zip")}`));
});

test("retained bytes, metadata, manifest and review hash are checked for both channels", (t) => {
    for (const version of ["0.2.0-alpha.2", "0.2.0"]) {
        const f = candidateFixture(t, version),
            candidate = f.read();
        assert.equal(candidate.channel, version.includes("-") ? "next" : "latest");
        assert.equal(
            candidate.integrity,
            `sha512-${createHash("sha512").update("retained candidate, never repacked").digest("base64")}`,
        );
        validateCandidate(f.directory, select(), candidate.candidateHash);
        assert.throws(() => validateCandidate(f.directory, select(), "0".repeat(64)));
        writeFileSync(path.join(f.directory, candidate.filename), "changed");
        assert.throws(f.read);
    }
    const mutations: ((f: ReturnType<typeof candidateFixture>) => void)[] = [
        (f) => {
            f.candidate.name = "ngne";
        },
        (f) => {
            f.candidate.name = "@that-webdev-dude/ngne";
        },
        (f) => {
            f.candidate.sourceSHA = "d".repeat(40);
        },
        (f) => {
            f.candidate.workflowRun += "1";
        },
        (f) => {
            f.candidate.runAttempt = "1";
        },
        (f) => {
            f.candidate.verification = "failed";
        },
        (f) => {
            f.candidate.publicationApproved = true;
        },
        (f) => {
            f.candidate.intendedTag = "v0.1.0";
        },
        (f) => {
            f.candidate.publishConfig.tag = "latest";
        },
        (f) => {
            f.candidate.publishConfig.registry = "https://example.com";
        },
        (f) => {
            f.candidate.tarball = "../escape.tgz";
        },
        (f) => {
            f.manifest.provenance.changes = " M src";
        },
        (f) => {
            f.manifest.provenance.revision = "d".repeat(40);
        },
        (f) => {
            f.manifest.runId = "wrong";
        },
        (f) => {
            f.manifest.prepared.package.sha256 = "0".repeat(64);
        },
    ];
    for (const mutate of mutations) {
        const f = candidateFixture(t);
        mutate(f);
        f.write();
        assert.throws(f.read);
    }
    const extra = candidateFixture(t);
    writeFileSync(path.join(extra.directory, "extra.txt"), "unexpected");
    assert.throws(extra.read);
});

test("registry absence, different bytes and uncertain outcomes never cause blind republishing", async (t) => {
    const candidate = candidateFixture(t).read();
    let sends = 0;
    assert.deepEqual(
        await publishOnce(
            candidate,
            async () => registry(candidate),
            () => {
                sends++;
            },
        ),
        { attempted: false, commandSucceeded: false },
    );
    assert.equal(sends, 0);
    assert.deepEqual(
        await publishOnce(
            candidate,
            async () => registry(candidate, false),
            () => {
                sends++;
                throw Error("Upload response lost");
            },
        ),
        { attempted: true, commandSucceeded: false },
    );
    assert.equal(sends, 1);
    // A rerun reconciles the now-existing exact version without a second upload.
    await publishOnce(
        candidate,
        async () => registry(candidate),
        () => {
            sends++;
        },
    );
    assert.equal(sends, 1);
    await assert.rejects(() =>
        publishOnce(
            candidate,
            async () => {
                throw Error("HTTP 503");
            },
            () => {
                sends++;
            },
        ),
    );
    const mismatch = registry(candidate);
    object(object(mismatch.versions)[candidate.version]).dist = { integrity: "wrong" };
    await assert.rejects(() =>
        publishOnce(
            candidate,
            async () => mismatch,
            () => {
                sends++;
            },
        ),
    );
    assert.equal(sends, 1);
    assert.throws(() =>
        registryVersion(
            { ...registry(candidate, false), time: { [candidate.version]: "old publication" } },
            candidate,
        ),
    );
});

test("a packument holding only the staged-bootstrap placeholder permits the absent candidate", (t) => {
    const candidate = candidateFixture(t).read();
    const placeholder = {
        name: candidate.name,
        versions: {
            "0.0.0-stage": { name: candidate.name, version: "0.0.0-stage", dist: {} },
        },
        "dist-tags": { latest: "0.0.0-stage" },
        time: { "0.0.0-stage": "staged" },
    };
    assert.equal(registryVersion(placeholder, candidate), null);
});

test("HTTP, authentication, JSON and network errors remain errors", async (t) => {
    const original = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = original;
    });
    for (const status of [401, 403, 404, 429, 500, 503]) {
        globalThis.fetch = async () => new Response('{"error":"Not found"}', { status });
        await assert.rejects(
            () => request("https://registry.npmjs.org/package"),
            new RegExp(`HTTP ${status}`),
        );
    }
    globalThis.fetch = async () => new Response("not json");
    await assert.rejects(() => request("https://registry.npmjs.org/package"));
    globalThis.fetch = async () => {
        throw Error("Network unavailable");
    };
    await assert.rejects(() => request("https://registry.npmjs.org/package"), /Network/);
});

test("signed-statement semantics reject wrong source, workflow, subject and invocation", (t) => {
    const candidate = candidateFixture(t).read();
    assert.deepEqual(validateProvenance(provenance(candidate), candidate), {
        runId: "321",
        runAttempt: "1",
        ref: "refs/heads/main",
    });
    const mutations: ((s: ReturnType<typeof provenance>) => void)[] = [
        (s) => {
            s.subject[0].digest.sha512 = "0".repeat(128);
        },
        (s) => {
            s.subject[0].name = "other-package";
        },
        (s) => {
            s.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "d".repeat(40);
        },
        (s) => {
            s.predicate.buildDefinition.externalParameters.workflow.repository =
                "https://github.com/fork/ngne";
        },
        (s) => {
            s.predicate.buildDefinition.externalParameters.workflow.path =
                ".github/workflows/release-candidate.yml";
        },
        (s) => {
            s.predicate.buildDefinition.externalParameters.workflow.ref = "refs/heads/other";
        },
        (s) => {
            s.predicate.runDetails.metadata.invocationId =
                "https://github.com/fork/ngne/actions/runs/321/attempts/1";
        },
        (s) => {
            s.predicate.runDetails.builder.id = "self-hosted";
        },
    ];
    for (const mutate of mutations) {
        const s = provenance(candidate);
        mutate(s);
        assert.throws(() => validateProvenance(s, candidate));
    }
    assert.equal(validateTag(null, sha), "create");
    assert.equal(validateTag(sha, sha), "existing");
    assert.throws(() => validateTag("d".repeat(40), sha), /never overwrite/);
});

test("tag parsing accepts matching existing tags and final checks require presence", () => {
    const tag = "v0.2.0",
        ref = `refs/tags/${tag}`;
    assert.equal(tagCommit("", tag), null);
    assert.equal(validateTag(tagCommit(`${sha}\t${ref}\n`, tag), sha, true), "existing");
    assert.equal(
        validateTag(tagCommit(`${"b".repeat(40)}\t${ref}\n${sha}\t${ref}^{}\n`, tag), sha, true),
        "existing",
    );
    assert.throws(() => validateTag(tagCommit("", tag), sha, true), /missing/);
    assert.throws(
        () => validateTag(tagCommit(`${"b".repeat(40)}\t${ref}\n`, tag), sha, true),
        /never overwrite/,
    );
});

test("uncertain upload reconciliation accepts earlier attempts while successful uploads bind exactly", () => {
    const origin = { runId: "123", runAttempt: "1" };
    validateInvocation(origin, "123", "2", false);
    validateInvocation(origin, "123", "1", true);
    assert.throws(() => validateInvocation(origin, "123", "2", true));
    assert.throws(() => validateInvocation(origin, "124", "2", false));
    assert.throws(
        () => validateInvocation({ ...origin, runAttempt: "3" }, "123", "2", false),
        /future/,
    );
});

test("final evidence inventories only uploaded files and hashes the final acceptance bytes", (t) => {
    const { directory } = candidateFixture(t);
    mkdirSync(path.join(directory, "smoke"));
    mkdirSync(path.join(directory, "npm-cache"));
    // A directory junction also works without Windows file-symlink privileges.
    symlinkSync(
        path.join(directory, "npm-cache"),
        path.join(directory, "smoke", "node_modules"),
        "junction",
    );
    writeFileSync(path.join(directory, "smoke/package.json"), "{}");
    writeFileSync(path.join(directory, "smoke/package-lock.json"), "{}");
    writeFileSync(path.join(directory, "result.json"), '{"accepted":false}\n');
    const accepted = '{"accepted":true}\n';
    const inventory = publicationInventory(directory, accepted);
    assert(
        !inventory.some(
            (file) => file.path.includes("node_modules") || file.path.includes("npm-cache"),
        ),
    );
    assert.equal(inventory.find((file) => file.path === "result.json")?.sha256, hash(accepted));
    assert(inventory.some((file) => file.path === "smoke/package-lock.json"));
});

test("workflow exposes review before the approval job and confines publication credentials", () => {
    const workflow = readFileSync(".github/workflows/publish-release.yml", "utf8");
    assert.match(workflow, /permissions: \{\}/);
    assert.match(
        workflow,
        /publish:\s+needs: review\s+runs-on: ubuntu-latest\s+environment: npm-publication/,
    );
    const review = workflow.split("  publish:")[0];
    assert(!review.includes("contents: write") && !review.includes("id-token: write"));
    assert.match(
        workflow,
        /REVIEWED_CANDIDATE_HASH: \$\{\{ needs.review.outputs.candidate_hash \}\}/,
    );
    assert(
        !workflow.includes("npm pack") &&
            !workflow.includes("NPM_TOKEN") &&
            !workflow.includes("push:"),
    );
    assert.match(workflow, /cancel-in-progress: false/);
});
