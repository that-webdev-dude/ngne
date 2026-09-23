import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ownProcess } from "../../tests/tooling/cleanup.mjs";
import type { Run } from "./run.js";

/** Every spawned process immediately receives the existing verified tree owner. */
export async function command(
    run: Run,
    name: string,
    executable: string,
    args: string[],
    cwd: string,
): Promise<string> {
    const logs = join(run.evidence, "stages", name, "logs");
    mkdirSync(logs, { recursive: true });
    const log = join(logs, "command.log");
    appendFileSync(log, `${JSON.stringify({ executable, args })}\n`);
    const child = spawn(executable, args, {
        cwd,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
    });
    const owner = ownProcess(child, name);
    run.cleanup.push([`${name} terminate/verify`, () => owner.stop()]);
    let stdout = "";
    child.stdout.on("data", (bytes: Buffer) => {
        stdout += bytes.toString();
        appendFileSync(log, bytes);
    });
    child.stderr.on("data", (bytes: Buffer) => appendFileSync(log, bytes));
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`${name}: command timeout`)), 120_000);
        child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once("close", (code, signal) => {
            clearTimeout(timer);
            code === 0 ? resolve() : reject(Error(`${name}: exit ${code ?? signal}; see ${log}`));
        });
    });
    return stdout;
}

export function npmPath(): string {
    if (!process.env.npm_execpath)
        throw Error("Run package preparation through npm run prepare:package");
    return process.env.npm_execpath;
}
