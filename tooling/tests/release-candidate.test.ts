import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";

// Exercise the workflow's actual inline guards without dispatching or mutating Git.
const workflow = readFileSync(".github/workflows/release-candidate.yml", "utf8");
const scripts = [...workflow.matchAll(/node <<'NODE'\r?\n([\s\S]*?)          NODE/g)].map((match) =>
    match[1].replace(/^          /gm, ""),
);
assert.equal(scripts.length, 2);
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const files = new Map<string, string | Buffer>();
    const write = (file: string, bytes: string | Buffer) => files.set(path.resolve(file), bytes);
    const read = (file: string) => {
        const bytes = files.get(path.resolve(file));
        assert.notEqual(bytes, undefined, `Missing fixture file ${file}`);
        return bytes!;
    };
    const state = { revision: "a".repeat(40), changes: "", tagRevision: "", tagExists: false };
    const env = {
        GITHUB_SHA: state.revision,
        RELEASE_TAG: `v${pkg.version}`,
        PREPARATION_MANIFEST: "out/preparation/evidence/manifest.json",
        GITHUB_STEP_SUMMARY: "out/summary.md",
    };
    const context = {
        process: { env },
        require: (id: string) => {
            if (id === "node:path") return path;
            if (id === "node:crypto") return { createHash };
            if (id === "node:fs")
                return {
                    readFileSync: read,
                    writeFileSync: write,
                    mkdirSync: () => {},
                    copyFileSync: (from: string, to: string) => write(to, read(from)),
                    appendFileSync: write,
                };
            assert.equal(id, "node:child_process");
            return {
                execFileSync: (_command: string, args: string[]) => {
                    if (args[0] === "status") return state.changes;
                    assert.equal(args[0], "rev-parse");
                    return args[1] === "HEAD" ? state.revision : state.tagRevision;
                },
                spawnSync: () => ({ status: state.tagExists ? 0 : 1 }),
            };
        },
    };
    const bind = () => {
        write("package.json", JSON.stringify(pkg));
        write("package-lock.json", JSON.stringify(lock));
        runInNewContext(scripts[0], { ...context });
    };
    const filename = `that-webdev-dude-ngne-${pkg.version}.tgz`;
    const manifest = {
        runId: "synthetic-release",
        provenance: { revision: state.revision, changes: "" },
        prepared: {
            package: {
                filename,
                path: `evidence/package/${filename}`,
                sha256: digest("candidate bytes"),
            },
        },
    };
    const assemble = () => {
        write(env.PREPARATION_MANIFEST, JSON.stringify(manifest));
        write("out/preparation/evidence/result.json", '{"accepted":true}');
        write(`out/preparation/evidence/package/${filename}`, "candidate bytes");
        runInNewContext(scripts[1], { ...context });
    };
    return { pkg, lock, state, env, manifest, bind, assemble, read };
}

test("release guards bind scoped metadata and assemble its unchanged npm filename", () => {
    const f = fixture();
    f.bind();
    f.assemble();
    const result = JSON.parse(String(f.read("out/release-candidate/candidate.json")));
    assert.equal(result.name, "@that-webdev-dude/ngne");
    assert.equal(result.intendedTag, `v${f.pkg.version}`);
    assert.equal(result.publicationApproved, false);
    assert.equal(result.tarball, `that-webdev-dude-ngne-${f.pkg.version}.tgz`);
    assert.equal(f.read(`out/release-candidate/${result.tarball}`), "candidate bytes");
    assert.match(
        String(f.read("out/release-candidate/SHA256SUMS")),
        new RegExp(result.tarballSHA256),
    );
});

test("release guards reject old name, mismatched lock, wrong tag/channel and source drift", () => {
    const mutations = [
        (f: ReturnType<typeof fixture>) => {
            f.pkg.name = "ngne";
        },
        (f: ReturnType<typeof fixture>) => {
            f.lock.packages[""].name = "ngne";
        },
        (f: ReturnType<typeof fixture>) => {
            f.lock.version = "0.2.0-alpha.0";
        },
        (f: ReturnType<typeof fixture>) => {
            f.env.RELEASE_TAG = "v0.2.0-alpha.0";
        },
        (f: ReturnType<typeof fixture>) => {
            f.pkg.publishConfig.tag = f.pkg.version.includes("-") ? "latest" : "next";
        },
        (f: ReturnType<typeof fixture>) => {
            f.state.tagExists = true;
            f.state.tagRevision = "b".repeat(40);
        },
        (f: ReturnType<typeof fixture>) => {
            f.state.changes = " M package.json";
        },
    ];
    for (const mutate of mutations) {
        const f = fixture();
        mutate(f);
        assert.throws(f.bind);
    }
});

test("candidate assembly rejects unscoped filename and changed archive hash", () => {
    for (const mutation of ["filename", "hash"] as const) {
        const f = fixture();
        f.bind();
        if (mutation === "filename")
            f.manifest.prepared.package.filename = "ngne-0.2.0-alpha.1.tgz";
        else f.manifest.prepared.package.sha256 = "0".repeat(64);
        assert.throws(f.assemble, /Prepared tarball identity mismatch/);
    }
});
