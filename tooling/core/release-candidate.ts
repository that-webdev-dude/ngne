import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
// Explicit TypeScript paths keep the pre-install binding phase runnable by Node 24.
import { contained, hash } from "../evidence/identity.ts";
import { object, readManifest, readResult, string } from "../evidence/schema.ts";

interface Source {
    name: string;
    version: string;
    publishConfig: Record<string, unknown>;
    sourceSHA: string;
    intendedTag: string;
    tagStatus: "matches-source" | "not-created";
    workflowRun: string;
    runAttempt: string;
}

const read = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
const git = (root: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();

export function bindCandidate(repository: string, env: NodeJS.ProcessEnv = process.env): Source {
    const root = resolve(repository);
    const pkg = object(read(join(root, "package.json")));
    const lock = object(read(join(root, "package-lock.json")));
    const locked = object(object(lock.packages)[""]);
    const sha = git(root, "rev-parse", "HEAD");
    const tag = env.RELEASE_TAG;
    if (sha !== env.GITHUB_SHA || git(root, "status", "--porcelain"))
        throw Error("Candidate must use the clean dispatch revision");
    const version = string(pkg.version);
    if (
        pkg.name !== "@ngne/core" ||
        pkg.private === true ||
        lock.version !== version ||
        locked.version !== version ||
        lock.name !== pkg.name ||
        locked.name !== pkg.name ||
        tag !== `v${version}`
    )
        throw Error("Package, lockfile and intended release tag must agree");
    const publishConfig = object(pkg.publishConfig);
    if (
        publishConfig.registry !== "https://registry.npmjs.org/" ||
        publishConfig.access !== "public" ||
        publishConfig.tag !== (version.includes("-") ? "next" : "latest")
    )
        throw Error("Unexpected registry, access or distribution tag");
    const exists = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`], {
        cwd: root,
        windowsHide: true,
    });
    if (exists.status !== 0 && exists.status !== 1) throw Error("Cannot inspect intended tag");
    if (exists.status === 0 && git(root, "rev-parse", `refs/tags/${tag}^{commit}`) !== sha)
        throw Error("Existing release tag points to another commit");
    const source: Source = {
        name: pkg.name,
        version,
        publishConfig,
        sourceSHA: sha,
        intendedTag: tag,
        tagStatus: exists.status === 0 ? "matches-source" : "not-created",
        workflowRun: `${string(env.GITHUB_SERVER_URL)}/${string(env.GITHUB_REPOSITORY)}/actions/runs/${string(env.GITHUB_RUN_ID)}`,
        runAttempt: string(env.GITHUB_RUN_ATTEMPT),
    };
    mkdirSync(join(root, "out"), { recursive: true });
    writeFileSync(join(root, "out/release-source.json"), json(source), { flag: "wx" });
    return source;
}

/** Assemble the already verified preparation; never build, pack, tag or publish here. */
export function assembleCandidate(repository: string, env: NodeJS.ProcessEnv = process.env): void {
    const root = resolve(repository);
    const source = object(read(join(root, "out/release-source.json")));
    const manifestPath = resolve(root, string(env.PREPARATION_MANIFEST));
    const manifest = readManifest(read(manifestPath));
    const result = readResult(read(join(dirname(manifestPath), "result.json")));
    if (
        !result.accepted ||
        result.runId !== manifest.runId ||
        manifest.preparation !== "prepared" ||
        !manifest.prepared ||
        !manifest.provenance ||
        manifest.provenance.revision !== source.sourceSHA ||
        manifest.provenance.changes.trim() ||
        git(root, "rev-parse", "HEAD") !== source.sourceSHA ||
        git(root, "status", "--porcelain")
    )
        throw Error("Preparation must be accepted and match the clean source");
    const pkg = manifest.prepared.package;
    const expectedFilename = `${string(source.name).replace(/^@/, "").replace("/", "-")}-${string(source.version)}.tgz`;
    if (pkg.filename !== expectedFilename || pkg.path !== `evidence/package/${pkg.filename}`)
        throw Error("Prepared tarball identity mismatch");
    const tarball = contained(dirname(dirname(manifestPath)), pkg.path);
    if (hash(readFileSync(tarball)) !== pkg.sha256)
        throw Error("Prepared tarball identity mismatch");
    const destination = join(root, "out/release-candidate");
    mkdirSync(destination); // Exclusive: a failed or earlier candidate is never overwritten.
    copyFileSync(tarball, join(destination, pkg.filename));
    copyFileSync(manifestPath, join(destination, "manifest.json"));
    const identity = {
        ...source,
        verification: "workflow-checks-passed",
        publicationApproved: false,
        preparationRunId: manifest.runId,
        tarball: pkg.filename,
        tarballSHA256: pkg.sha256,
        manifestSHA256: hash(readFileSync(manifestPath)),
        evidenceArtifact: `release-diagnostics-${string(env.GITHUB_RUN_ID)}-${string(env.GITHUB_RUN_ATTEMPT)}`,
        limits: "Automated Linux/SwiftShader evidence. Review and final publication approval required. Evidence archive is not a resumable prepared workspace.",
    };
    writeFileSync(join(destination, "candidate.json"), json(identity));
    const sums =
        [pkg.filename, "manifest.json", "candidate.json"]
            .map((file) => `${hash(readFileSync(join(destination, file)))}  ${file}`)
            .join("\n") + "\n";
    writeFileSync(join(destination, "SHA256SUMS"), sums);
    appendFileSync(
        resolve(root, string(env.GITHUB_STEP_SUMMARY)),
        `Candidate ${source.name}@${source.version}, source ${source.sourceSHA}, intended tag ${source.intendedTag} (${source.tagStatus}).\n\n` +
            `Tarball SHA-256: ${pkg.sha256}\n\n` +
            "Review only: require a successful whole job, inspect evidence/contents and recheck hashes and tag before explicit publication approval. Publish the downloaded .tgz without rebuilding or repacking. No publication occurred.\n",
    );
}
