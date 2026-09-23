import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const hash = (bytes: string | Buffer): string =>
    createHash("sha256").update(bytes).digest("hex");
export type Identities = Record<string, string>;

export function safePath(path: string): boolean {
    return (
        !!path &&
        !isAbsolute(path) &&
        !/[\\:\x00]/.test(path) &&
        !path.split("/").some((part) => !part || part === "." || part === "..")
    );
}

/** Lexical and physical containment; symlinked payloads are never trusted. */
export function contained(root: string, path: string): string {
    if (!safePath(path)) throw Error(`Unsafe relative path: ${path}`);
    const base = realpathSync(root);
    let target = base;
    for (const part of path.split("/")) {
        target = join(target, part);
        if (lstatSync(target).isSymbolicLink()) throw Error(`Linked payload: ${path}`);
    }
    const rel = relative(base, realpathSync(target));
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
        throw Error(`Escaping path: ${path}`);
    return target;
}

/** Extracted from content/fixtures.mjs: same SHA-256 bytes and stable POSIX keys. */
export function identities(root: string): Identities {
    if (lstatSync(root).isSymbolicLink()) throw Error(`Linked inventory root: ${root}`);
    const files: Identities = {};
    function walk(dir: string): void {
        for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
            a.name.localeCompare(b.name),
        )) {
            const path = join(dir, item.name);
            if (item.isSymbolicLink()) throw Error(`Linked inventory entry: ${path}`);
            if (item.isDirectory()) walk(path);
            else if (item.isFile())
                files[relative(root, path).replaceAll("\\", "/")] = hash(readFileSync(path));
            else throw Error(`Unsupported inventory entry: ${path}`);
        }
    }
    walk(resolve(root));
    return files;
}

export function verifyIdentities(root: string, expected: Identities): void {
    const actual = identities(root);
    const keys = Object.keys(expected).sort();
    if (
        JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(keys) ||
        keys.some((key) => actual[key] !== expected[key])
    )
        throw Error(`Changed identities: ${root}`);
}
