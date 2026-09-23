import { resolve } from "node:path";
import { buildPackage } from "../core/package.js";
import { prepare, verifyPrepared } from "../core/preparation.js";

try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "build" && !args.length) buildPackage(process.cwd());
    else if (mode === "verify" && args.length === 2 && args[0] === "--manifest") {
        const manifest = verifyPrepared(resolve(args[1]));
        console.log(`Verified prepared run: ${manifest.runId}`);
    } else if (
        mode === "prepare" &&
        (!args.length || (args.length === 2 && args[0] === "--output"))
    ) {
        const run = await prepare(process.cwd(), args[1]);
        console.log(resolve(run.evidence, "manifest.json"));
        if (!run.result.accepted) {
            console.error(run.result.failures);
            process.exitCode = 1;
        }
    } else
        throw Error("Usage: build | prepare [--output fresh-directory] | verify --manifest path");
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
