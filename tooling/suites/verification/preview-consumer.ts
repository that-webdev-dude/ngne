import assert from "node:assert/strict";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { contained, hash, type Identities } from "../../evidence/identity.js";

/** npm's POSIX launcher is the only link allowed in this disposable consumer. */
export function previewConsumerIdentity(root: string, platform = process.platform) {
    if (lstatSync(root).isSymbolicLink()) throw Error(`Linked consumer root: ${root}`);
    const target = "node_modules/ngne/dist/preview/cli.js";
    const cli = contained(root, target);
    assert.ok(lstatSync(cli).isFile(), "Preview CLI must be a regular file");
    const bin = contained(root, "node_modules/.bin");
    const launcher = `node_modules/.bin/ngne-preview${platform === "win32" ? ".cmd" : ""}`;
    let link: string | null = null;
    if (platform === "win32") {
        const shim = contained(root, launcher);
        assert.ok(lstatSync(shim).isFile(), "Preview shim must be a regular file");
        assert.ok(
            readFileSync(shim, "utf8").includes('"%dp0%\\..\\ngne\\dist\\preview\\cli.js"'),
            "Unexpected preview shim target",
        );
    } else {
        const shim = join(bin, "ngne-preview");
        assert.ok(lstatSync(shim).isSymbolicLink(), "Preview launcher must be npm's symlink");
        link = readlinkSync(shim);
        assert.equal(link, "../ngne/dist/preview/cli.js", "Unexpected preview launcher target");
    }
    const files: Identities = {};
    function walk(directory: string, prefix = ""): void {
        for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
            a.name.localeCompare(b.name),
        )) {
            const path = prefix + item.name;
            if (link !== null && path === launcher) continue;
            const absolute = join(directory, item.name);
            if (item.isSymbolicLink()) throw Error(`Linked consumer entry: ${path}`);
            if (item.isDirectory()) walk(absolute, `${path}/`);
            else if (item.isFile()) files[path] = hash(readFileSync(absolute));
            else throw Error(`Unsupported consumer entry: ${path}`);
        }
    }
    walk(root);
    return { files, launcher: { path: launcher, link, target, sha256: hash(readFileSync(cli)) } };
}

export function verifyPreviewConsumer(
    root: string,
    expected: ReturnType<typeof previewConsumerIdentity>,
    platform = process.platform,
): void {
    assert.deepEqual(previewConsumerIdentity(root, platform), expected, "Changed preview consumer");
}
