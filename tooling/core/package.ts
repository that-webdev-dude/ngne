import { execFileSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { contained, hash, type Identities } from "../evidence/identity.js";
import { object, string } from "../evidence/schema.js";
import { command, npmPath } from "./process.js";
import type { Run } from "./run.js";

/** Only the dedicated emission directory is removed; never the showcase or user outputs. */
export function cleanEmission(repository: string, target: "engine" | "preview" = "engine"): void {
    const root = realpathSync(repository),
        dist = join(root, "dist"),
        emission = join(dist, target);
    if (existsSync(dist) && (lstatSync(dist).isSymbolicLink() || realpathSync(dist) !== dist))
        throw Error("Linked dist directory");
    if (
        existsSync(emission) &&
        (lstatSync(emission).isSymbolicLink() || realpathSync(emission) !== emission)
    )
        throw Error(`Linked ${target} emission`);
    if (resolve(emission) !== join(root, "dist", target)) throw Error("Unsafe emission target");
    rmSync(emission, { recursive: true, force: true });
}

export function buildPackage(repository: string): void {
    cleanEmission(repository);
    cleanEmission(repository, "preview");
    for (const config of [
        "tsconfig.lib.json",
        "tooling/preview/tsconfig.node.json",
        "tooling/preview/tsconfig.browser.json",
    ])
        execFileSync(
            process.execPath,
            [join(repository, "node_modules/typescript/bin/tsc"), "-p", config],
            { cwd: repository, stdio: "inherit", windowsHide: true },
        );
    copyFileSync(
        join(repository, "tooling/preview/index.html"),
        join(repository, "dist/preview/index.html"),
    );
}

export async function pack(
    run: Run,
    repository: string,
): Promise<{ path: string; filename: string; sha256: string; files: Identities }> {
    const destination = join(run.evidence, "package");
    mkdirSync(destination);
    const output: unknown = JSON.parse(
        await command(
            run,
            "pack",
            process.execPath,
            [
                npmPath(),
                "pack",
                "--json",
                "--ignore-scripts",
                "--pack-destination",
                destination,
                "--cache",
                join(run.root, "work/cache"),
            ],
            repository,
        ),
    );
    if (!Array.isArray(output) || output.length !== 1)
        throw Error("Expected exactly one packed artifact");
    const entry = object(output[0]),
        filename = string(entry.filename);
    if (filename !== filename.split(/[\\/]/).at(-1) || !filename.endsWith(".tgz"))
        throw Error("Invalid npm pack filename");
    if (!Array.isArray(entry.files)) throw Error("Missing npm pack files");
    const files: Identities = {};
    for (const item of entry.files) {
        const path = string(object(item).path);
        if (path in files) throw Error("Duplicate package path");
        files[path] = hash(readFileSync(contained(repository, path)));
    }
    for (const required of [
        "package.json",
        "dist/engine/index.js",
        "dist/engine/index.d.ts",
        "dist/preview/cli.js",
        "dist/preview/host.js",
        "dist/preview/model.js",
        "dist/preview/playback.js",
        "dist/preview/inspection.js",
        "dist/preview/browser.js",
        "dist/preview/index.html",
        "docs/guide.md",
    ])
        if (!files[required]) throw Error(`Missing required package content: ${required}`);
    const pkg = object(JSON.parse(readFileSync(join(repository, "package.json"), "utf8")));
    if (pkg.name !== "ngne") throw Error("Unexpected package name");
    if (object(pkg.bin)["ngne-preview"] !== "dist/preview/cli.js")
        throw Error("Missing preview executable mapping");
    for (const key of ["dependencies", "optionalDependencies", "peerDependencies"])
        if (pkg[key] && Object.keys(object(pkg[key])).length)
            throw Error("Package dependencies require an explicit lock policy update");
    return {
        path: `evidence/package/${filename}`,
        filename,
        sha256: hash(readFileSync(contained(destination, filename))),
        files,
    };
}
