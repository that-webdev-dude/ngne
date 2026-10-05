import assert from "node:assert/strict";
import test from "node:test";
import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    renameSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash, identities } from "../evidence/identity.js";
import {
    previewConsumerIdentity,
    verifyPreviewConsumer,
} from "../suites/verification/preview-consumer.js";

function consumer(t: { after: (fn: () => void) => void }) {
    const root = mkdtempSync(join(tmpdir(), "ngne-preview-consumer-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "node_modules/@ngne/core/dist/preview"), { recursive: true });
    mkdirSync(join(root, "node_modules/.bin"));
    writeFileSync(join(root, "node_modules/@ngne/core/dist/preview/cli.js"), "// CLI");
    writeFileSync(join(root, "preview.config.mjs"), "export default {};");
    writeFileSync(join(root, "package-lock.json"), "{}");
    return root;
}

function posixLauncher(root: string, t: { skip: (reason: string) => void }) {
    try {
        symlinkSync(
            "../@ngne/core/dist/preview/cli.js",
            join(root, "node_modules/.bin/ngne-preview"),
        );
        return true;
    } catch (error) {
        if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM")
            throw error;
        t.skip("Windows file symlinks require Developer Mode or elevation; Linux runs this test.");
        return false;
    }
}

test("POSIX npm launcher is recorded separately without weakening strict payload inventories", (t) => {
    const root = consumer(t);
    if (!posixLauncher(root, t)) return;
    const snapshot = previewConsumerIdentity(root, "linux");
    assert.deepEqual(snapshot.launcher, {
        path: "node_modules/.bin/ngne-preview",
        link: "../@ngne/core/dist/preview/cli.js",
        target: "node_modules/@ngne/core/dist/preview/cli.js",
        sha256: hash("// CLI"),
    });
    assert.equal(snapshot.files["preview.config.mjs"], hash("export default {};"));
    assert.equal(snapshot.files["node_modules/@ngne/core/dist/preview/cli.js"], hash("// CLI"));
    verifyPreviewConsumer(root, snapshot, "linux");
    assert.throws(() => identities(root), /Linked inventory entry/);
});

for (const target of [
    "../@ngne/core/other.js",
    "../ngne/dist/preview/cli.js",
    "../@other/ngne/dist/preview/cli.js",
    "../../../escape.js",
]) {
    test(`POSIX launcher rejects unexpected target ${target}`, (t) => {
        const root = consumer(t);
        if (!posixLauncher(root, t)) return;
        const launcher = join(root, "node_modules/.bin/ngne-preview");
        unlinkSync(launcher);
        symlinkSync(target, launcher);
        assert.throws(() => previewConsumerIdentity(root, "linux"), /Unexpected preview launcher/);
    });
}

test("POSIX consumer rejects additional links and a linked CLI payload", (t) => {
    const root = consumer(t);
    if (!posixLauncher(root, t)) return;
    const extra = join(root, "node_modules/.bin/unexpected");
    symlinkSync("../@ngne/core/dist/preview/cli.js", extra);
    assert.throws(() => previewConsumerIdentity(root, "linux"), /Linked consumer entry/);
    unlinkSync(extra);
    const cli = join(root, "node_modules/@ngne/core/dist/preview/cli.js");
    unlinkSync(cli);
    symlinkSync(join(root, "preview.config.mjs"), cli);
    assert.throws(() => previewConsumerIdentity(root, "linux"), /Linked payload/);
});

test("POSIX consumer rejects linked launcher directories", (t) => {
    const root = consumer(t);
    const bin = join(root, "node_modules/.bin");
    rmSync(bin, { recursive: true });
    symlinkSync(join(root, "node_modules/@ngne/core"), bin, "junction");
    assert.throws(() => previewConsumerIdentity(root, "linux"), /Linked payload/);
});

test("POSIX launcher rejects a regular file in place of npm's link", (t) => {
    const root = consumer(t);
    writeFileSync(join(root, "node_modules/.bin/ngne-preview"), "unexpected launcher");
    assert.throws(() => previewConsumerIdentity(root, "linux"), /must be npm's symlink/);
});

test("Windows consumer rejects unexpected directory links and linked command shims", (t) => {
    const root = consumer(t);
    const cmd = join(root, "node_modules/.bin/ngne-preview.cmd");
    writeFileSync(cmd, 'node "%dp0%\\..\\@ngne\\core\\dist\\preview\\cli.js" %*');
    const extra = join(root, "linked-input");
    symlinkSync(join(root, "node_modules/@ngne/core"), extra, "junction");
    assert.throws(() => previewConsumerIdentity(root, "win32"), /Linked consumer entry/);
    unlinkSync(extra);
    unlinkSync(cmd);
    symlinkSync(join(root, "node_modules/@ngne/core"), cmd, "junction");
    assert.throws(() => previewConsumerIdentity(root, "win32"), /Linked payload/);
});

test("Windows npm shims stay regular hashed files and require the expected CLI target", (t) => {
    const root = consumer(t);
    const cmd = join(root, "node_modules/.bin/ngne-preview.cmd");
    writeFileSync(cmd, '@echo off\nnode "%dp0%\\..\\@ngne\\core\\dist\\preview\\cli.js" %*');
    for (const name of ["ngne-preview", "ngne-preview.ps1"])
        writeFileSync(join(root, "node_modules/.bin", name), "npm shim");
    const snapshot = previewConsumerIdentity(root, "win32");
    assert.equal(snapshot.launcher.link, null);
    assert.deepEqual(snapshot.files, identities(root));
    verifyPreviewConsumer(root, snapshot, "win32");
    writeFileSync(cmd, '@echo off\nnode "%dp0%\\..\\ngne\\dist\\preview\\cli.js" %*');
    assert.throws(() => previewConsumerIdentity(root, "win32"), /Unexpected preview shim target/);
    writeFileSync(cmd, '@echo off\nnode "%dp0%\\..\\elsewhere.js" %*');
    assert.throws(() => previewConsumerIdentity(root, "win32"), /Unexpected preview shim target/);
});

test("consumer rejects a linked scope directory before reading the CLI", (t) => {
    const root = consumer(t);
    const scope = join(root, "node_modules/@ngne");
    const external = join(root, "external-scope");
    renameSync(scope, external);
    symlinkSync(external, scope, "junction");
    assert.throws(() => previewConsumerIdentity(root, "win32"), /Linked payload/);
});

for (const mutation of ["fixture", "package", "shim", "added", "missing"] as const) {
    test(`consumer integrity detects ${mutation} mutation`, (t) => {
        const root = consumer(t);
        const shim = join(root, "node_modules/.bin/ngne-preview.cmd");
        const contents = 'node "%dp0%\\..\\@ngne\\core\\dist\\preview\\cli.js" %*';
        writeFileSync(shim, contents);
        const snapshot = previewConsumerIdentity(root, "win32");
        if (mutation === "fixture") writeFileSync(join(root, "preview.config.mjs"), "changed");
        if (mutation === "package")
            writeFileSync(join(root, "node_modules/@ngne/core/dist/preview/cli.js"), "changed");
        if (mutation === "shim") writeFileSync(shim, `rem changed\n${contents}`);
        if (mutation === "added") writeFileSync(join(root, "unexpected.txt"), "new");
        if (mutation === "missing") unlinkSync(join(root, "preview.config.mjs"));
        assert.throws(
            () => verifyPreviewConsumer(root, snapshot, "win32"),
            /Changed preview consumer/,
        );
    });
}
