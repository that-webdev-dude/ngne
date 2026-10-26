import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "vite";

for (const mode of ["production", "browser"])
    test(`${mode} build retires the root page in a reused output directory without removing modules`, async (t) => {
        const output = mkdtempSync(join(tmpdir(), "ngne-site-build-"));
        t.after(() => rmSync(output, { recursive: true, force: true }));
        const preserved = {
            "engine/index.js": "export const engine = true;\n",
            "engine/index.d.ts": "export declare const engine = true;\n",
            "engine/internal/renderer.js": "export const renderer = true;\n",
            "preview/cli.js": "export const preview = true;\n",
            "preview/index.html": "<html><body>Preserved preview</body></html>\n",
            "unrelated.txt": "Unrelated output\n",
        };
        for (const [name, contents] of Object.entries(preserved)) {
            mkdirSync(dirname(join(output, name)), { recursive: true });
            writeFileSync(join(output, name), contents);
        }
        for (const previousPage of ["Retired demo", "Rejected landing page"]) {
            writeFileSync(join(output, "index.html"), `<html><body>${previousPage}</body></html>`);
            await build({
                configFile: resolve("vite.config.ts"),
                mode,
                logLevel: "silent",
                // These cleanup checks must also run before any engine emission exists.
                resolve: { alias: { "@ngne/core": resolve("src/index.ts") } },
                build: { outDir: output },
            });
            assert.equal(existsSync(join(output, "index.html")), false);
            for (const [name, contents] of Object.entries(preserved))
                assert.deepEqual(readFileSync(join(output, name)), Buffer.from(contents), name);
            for (const name of [
                "examples/hello/index.html",
                "examples/platformer/index.html",
                ...(mode === "browser"
                    ? ["validation.html", "tooling/suites/benchmarks/rendering/browser/index.html"]
                    : []),
            ])
                assert.equal(existsSync(join(output, name)), true, name);
        }
    });
