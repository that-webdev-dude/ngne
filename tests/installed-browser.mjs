import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ownProcess, runWithCleanup } from "./tooling/cleanup.mjs";

const root = process.cwd();
const installed = resolve(
    process.env.NGNE_INSTALLED_CONTENT_DIR ?? ".test-output/installed-content",
);
const consumer = join(installed, "consumer");
const output = resolve(process.env.NGNE_INSTALLED_BROWSER_DIR ?? join(installed, "browser"));
const manifest = JSON.parse(readFileSync(join(installed, "manifest.json"), "utf8"));
assert.deepEqual(
    manifest.fixture,
    JSON.parse(readFileSync("tests/fixtures/town-dungeon.json", "utf8")),
);
mkdirSync(output, { recursive: true });
const steps = [],
    cleanup = [];
function owned(args, label, options = {}) {
    const child = spawn(process.execPath, args, {
        cwd: root,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
    });
    const owner = ownProcess(child, label);
    steps.unshift([label, () => owner.stop()]);
    for (const stream of [child.stdout, child.stderr])
        stream.on("data", (data) => appendFileSync(join(output, `${label}.log`), data));
    return { child, owner };
}
const failures = await runWithCleanup(
    async () => {
        for (const [base, pathname, dist, port] of [
            ["root", "/", "dist", 4297],
            ["nested", "/town-dungeon/", "dist-nested", 4298],
        ]) {
            const disposable = join(output, `${base}-build`);
            // Reject reused outputs, including stale result files.
            mkdirSync(disposable);
            cpSync(join(consumer, dist), disposable, { recursive: true });
            const { owner } = owned(
                [
                    join(consumer, "node_modules/vite/bin/vite.js"),
                    "preview",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    String(port),
                    "--strictPort",
                    "--base",
                    pathname,
                    "--outDir",
                    disposable,
                ],
                `${base}-preview`,
                { cwd: consumer },
            );
            const url = `http://127.0.0.1:${port}${pathname}`;
            const deadline = Date.now() + 20_000;
            while (true) {
                owner.check();
                try {
                    if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) break;
                } catch {}
                assert(Date.now() < deadline, `${base} preview readiness timeout`);
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            const { child } = owned(["--import", "tsx", "tests/browser-ci.ts"], `${base}-runner`, {
                env: {
                    ...process.env,
                    NGNE_CONSUMER_URL: url,
                    NGNE_CONSUMER_DIST: disposable,
                    NGNE_BROWSER_ARTIFACT_DIR: relative(root, join(output, base)),
                },
            });
            const [code] = await once(child, "exit");
            assert.equal(code, 0, `${base} browser runner failed; see ${base}-runner.log`);
            const result = JSON.parse(readFileSync(join(output, base, "results.json"), "utf8"));
            assert.equal(result.status, "passed");
            console.log(`${base}: ${result.passed.length} browser assertions passed`);
        }
    },
    null,
    steps,
    cleanup,
);
writeFileSync(
    join(output, "orchestration.json"),
    JSON.stringify(
        {
            recordedAt: new Date().toISOString(),
            fixture: manifest.fixture.consumerRevision,
            packageSHA256: manifest.packageSHA256,
            failures,
            cleanup,
        },
        null,
        2,
    ) + "\n",
);
if (failures.length) {
    console.error(failures);
    process.exitCode = 1;
}
