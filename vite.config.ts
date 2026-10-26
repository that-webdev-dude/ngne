import { defineConfig, type UserConfig } from "vite";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command, mode }): UserConfig => ({
    base: "./",
    plugins: [
        {
            name: "remove-retired-root-page",
            apply: "build",
            writeBundle({ dir }) {
                // Shared output retains engine modules; only the obsolete root page is removed.
                if (dir) rmSync(resolve(dir, "index.html"), { force: true });
            },
        },
    ],
    resolve: {
        alias:
            command === "serve"
                ? {
                      "@ngne/core": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
                  }
                : {},
    },
    build: {
        // Preserve the engine modules emitted before the consumer bundles.
        emptyOutDir: false,
        rollupOptions: {
            input: {
                hello: "examples/hello/index.html",
                platformer: "examples/platformer/index.html",
                ...(mode === "browser"
                    ? {
                          benchmark: "tooling/suites/benchmarks/rendering/browser/index.html",
                          validation: "validation.html",
                      }
                    : {}),
            },
        },
    },
}));
