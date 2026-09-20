import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { gunzipSync } from "node:zlib";

// The archived consumer owns its game schemas. This runner only installs and verifies it.
const root = process.cwd();
const output = resolve(process.env.NGNE_INSTALLED_CONTENT_DIR ?? ".test-output/installed-content");
const consumer = join(output, "consumer");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const archive = readFileSync("tests/fixtures/town-dungeon.json.gz");
const fixture = JSON.parse(readFileSync("tests/fixtures/town-dungeon.json", "utf8"));
assert.equal(sha256(archive), fixture.archiveSHA256);
const files = JSON.parse(gunzipSync(archive));
assert.deepEqual(Object.keys(files).sort(), Object.keys(fixture.files).sort());
mkdirSync(output, { recursive: true });
// A fresh directory prevents old dependencies or builds from satisfying a check.
mkdirSync(consumer);
for (const [name, encoded] of Object.entries(files)) {
    assert(
        /^[a-zA-Z0-9_./-]+$/.test(name) && !name.startsWith("/") && !name.split("/").includes(".."),
    );
    const bytes = Buffer.from(encoded, "base64");
    assert.equal(sha256(bytes), fixture.files[name], name);
    const target = join(consumer, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
}
function npm(args, cwd) {
    assert(process.env.npm_execpath, "Run through npm run test:installed");
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
        cwd,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
    });
}
function run(name, args, cwd = consumer) {
    try {
        const text = npm(args, cwd);
        writeFileSync(join(output, name + ".log"), text);
        process.stdout.write(text);
        return text;
    } catch (error) {
        writeFileSync(
            join(output, name + ".log"),
            String(error.stdout ?? "") + String(error.stderr ?? error),
        );
        throw error;
    }
}
mkdirSync(join(consumer, "vendor"));
const pack = JSON.parse(
    run("pack", ["pack", "--json", "--pack-destination", join(consumer, "vendor")], root),
);
assert.equal(pack.length, 1);
assert(pack[0].files.some((file) => file.path === "dist/engine/index.js"));
assert(pack[0].files.some((file) => file.path === "dist/engine/index.d.ts"));
run("install", ["install", "./vendor/ngne-0.1.0.tgz", "--ignore-scripts"]);
run("ci", ["ci"]);
run("test", ["test"]);
run("build", ["run", "build"]);
run("build-nested", ["run", "build:nested"]);
run("check-package", ["run", "check:package"]);
function identities(directory, prefix = "") {
    return Object.fromEntries(
        readdirSync(directory, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name))
            .flatMap((entry) => {
                const name = prefix + entry.name,
                    path = join(directory, entry.name);
                return entry.isDirectory()
                    ? Object.entries(identities(path, name + "/"))
                    : [[name, sha256(readFileSync(path))]];
            }),
    );
}
writeFileSync(
    join(output, "manifest.json"),
    JSON.stringify(
        {
            recordedAt: new Date().toISOString(),
            engine: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
            engineChanges: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }),
            node: process.version,
            fixture,
            packageSHA256: sha256(readFileSync(join(consumer, "vendor/ngne-0.1.0.tgz"))),
            installed: identities(join(consumer, "node_modules/ngne")),
            source: identities(join(consumer, "src")),
            rootBuild: identities(join(consumer, "dist")),
            nestedBuild: identities(join(consumer, "dist-nested")),
        },
        null,
        2,
    ) + "\n",
);
console.log(`Installed content artifact: ${output}`);
