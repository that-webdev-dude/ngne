import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { contained, hash, identities, verifyIdentities } from "../evidence/identity.js";
import { readArtifacts, readManifest, readResult, type Manifest } from "../evidence/schema.js";
import { Run } from "./run.js";
import { pack } from "./package.js";
import { installFixture } from "./fixture.js";
import { command, npmPath } from "./process.js";

const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

export async function prepare(repository: string, output?: string): Promise<Run> {
    const root = resolve(repository),
        run = new Run(root, "package", output);
    await run.execute(async () => {
        await run.stage("provenance", async () => {
            const git = (args: string[]) =>
                execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
            run.manifest.provenance = {
                revision: git(["rev-parse", "HEAD"]).trim(),
                changes: git(["status", "--porcelain"]),
            };
            run.manifest.harness = Object.fromEntries([
                ...["tooling/core", "tooling/evidence", "tooling/commands"].flatMap((directory) =>
                    Object.entries(identities(join(root, directory))).map(([path, digest]) => [
                        `${directory}/${path}`,
                        digest,
                    ]),
                ),
                ...[
                    "tooling/core/cleanup.mjs",
                    "tsconfig.lib.json",
                    "tsconfig.json",
                    "package.json",
                    "package-lock.json",
                    "node_modules/typescript/package.json",
                    "node_modules/vite/package.json",
                    "node_modules/esbuild/package.json",
                ].map((path) => [path, hash(readFileSync(join(root, path)))]),
            ]);
            run.manifest.policy = {
                dependencyPolicy: "offline-lockfile-ci-no-scripts",
                bases: ["/", "/nested/"],
                browserExecuted: false,
            };
            run.manifest.preparation = "running";
        });
        await run.stage("package-build", async () => {
            await command(
                run,
                "package-build",
                process.execPath,
                [npmPath(), "run", "build:package"],
                root,
            );
        });
        let pkg: Awaited<ReturnType<typeof pack>> | undefined;
        await run.stage("package-pack", async () => {
            pkg = await pack(run, root);
        });
        await run.stage("fixture", async () => {
            if (!pkg) throw Error("Package stage did not produce an artifact");
            run.manifest.prepared = await installFixture(run, root, pkg);
            run.manifest.preparation = "prepared";
        });
    });
    return run;
}

/** Exact local handoff only: portable evidence without its installation is not resumable. */
export function verifyPrepared(manifestPath: string): Manifest {
    const absolute = resolve(manifestPath),
        evidence = dirname(absolute),
        root = dirname(evidence);
    if (absolute !== join(root, "evidence/manifest.json"))
        throw Error("Expected explicit evidence/manifest.json");
    const manifest = readManifest(read(absolute)),
        result = readResult(read(join(evidence, "result.json"))),
        artifacts = readArtifacts(read(join(evidence, "artifacts.json")));
    if (manifest.runId !== result.runId || result.runId !== artifacts.runId)
        throw Error("Cross-document run ID mismatch");
    if (manifest.preparation !== "prepared" || !manifest.prepared || !result.accepted)
        throw Error("Incomplete or unsuccessful preparation");
    const required = [
        "manifest.json",
        "result.json",
        "report.md",
        `package/${manifest.prepared.package.filename}`,
    ];
    for (const path of required)
        if (!artifacts.files.some((file) => file.path === path))
            throw Error(`Missing required artifact: ${path}`);
    const actual = identities(evidence);
    delete actual["artifacts.json"];
    if (
        JSON.stringify(Object.keys(actual).sort()) !==
        JSON.stringify(artifacts.files.map((f) => f.path).sort())
    )
        throw Error("Changed evidence inventory");
    for (const file of artifacts.files) {
        const path = contained(evidence, file.path);
        if (hash(readFileSync(path)) !== file.sha256 || statSync(path).size !== file.bytes)
            throw Error(`Changed artifact: ${file.path}`);
    }
    const p = manifest.prepared;
    if (
        p.package.path !== `evidence/package/${p.package.filename}` ||
        hash(readFileSync(contained(root, p.package.path))) !== p.package.sha256
    )
        throw Error("Changed package identity");
    for (const tree of [p.installed, p.workload, p.dependencies, p.builds.root, p.builds.nested])
        verifyIdentities(contained(root, tree.path), tree.files);
    verifyIdentities(contained(root, p.installed.path), p.package.files);
    const installation = dirname(dirname(contained(root, p.installed.path)));
    for (const file of ["package.json", "package-lock.json"])
        if (hash(readFileSync(contained(installation, file))) !== p.dependencies.files[file])
            throw Error(`Changed installation ${file}`);
    if (p.toolchain.node !== process.version) throw Error("Changed Node toolchain");
    return manifest;
}

export function copyPreparedBuild(
    manifestPath: string,
    base: "root" | "nested",
    destination: string,
): void {
    const manifest = verifyPrepared(manifestPath);
    const runRoot = dirname(dirname(resolve(manifestPath)));
    const rel = relative(runRoot, resolve(destination));
    if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
        throw Error("Disposable build must be outside the prepared run");
    mkdirSync(destination); // Caller must provide a fresh disposable destination.
    const build = manifest.prepared!.builds[base];
    cpSync(contained(runRoot, build.path), destination, { recursive: true });
    verifyIdentities(destination, build.files);
}
