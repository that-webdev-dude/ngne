import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { contained } from "../evidence/identity.js";
import { closeServer } from "./cleanup.mjs";
import type { Run } from "./run.js";

/** Serve only a verified disposable build, with no SPA/source fallback. */
export async function serve(run: Run, directory: string, base: string): Promise<string> {
    const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".png": "image/png",
        ".wav": "audio/wav",
    };
    const server = createServer((request, response) => {
        try {
            const pathname = decodeURIComponent(
                new URL(request.url ?? "/", "http://localhost").pathname,
            );
            if (!pathname.startsWith(base)) throw Error("Outside base");
            const path = contained(directory, pathname.slice(base.length) || "index.html");
            const bytes = readFileSync(path);
            response.writeHead(200, {
                "Content-Type": mime[extname(path)] ?? "application/octet-stream",
                "Cache-Control": "no-store",
            });
            response.end(bytes);
        } catch {
            response.writeHead(404);
            response.end("Not found");
        }
    });
    run.cleanup.push([`server ${base}`, () => closeServer(server)]);
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No server address");
    return `http://127.0.0.1:${address.port}${base}`;
}
