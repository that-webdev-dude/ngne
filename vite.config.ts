import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => ({
    base: "./",
    resolve: {
        alias:
            command === "serve"
                ? { ngne: fileURLToPath(new URL("./src/index.ts", import.meta.url)) }
                : {},
    },
    build: {
        // Preserve the engine modules emitted before the consumer bundles.
        emptyOutDir: false,
        rollupOptions: {
            input: {
                game: "index.html",
                hello: "examples/hello/index.html",
                platformer: "examples/platformer/index.html",
            },
        },
    },
}));
