import { resolve } from "node:path";
import { installed } from "../suites/verification/browser/installed.js";

try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--manifest"))
        throw Error("Usage: verify [--manifest exact-path]");
    const run = await installed(process.cwd(), args[1] ? resolve(args[1]) : undefined);
    console.log(`Installed verification: ${run.evidence}`);
    if (!run.result.accepted) throw Error(JSON.stringify(run.result.failures));
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
