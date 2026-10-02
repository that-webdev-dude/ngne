import { resolve } from "node:path";
import { verifyPreview } from "../suites/verification/preview.js";

try {
    const args = process.argv.slice(2);
    if (
        args[0] !== "--manifest" ||
        !args[1] ||
        ![2, 4].includes(args.length) ||
        (args.length === 4 && args[2] !== "--fixture")
    )
        throw Error(
            "Usage: verify-preview --manifest exact-path [--fixture isolated-input-directory]",
        );
    const run = await verifyPreview(
        process.cwd(),
        resolve(args[1]),
        args[3] ? resolve(args[3]) : undefined,
    );
    console.log(`Preview verification: ${run.evidence}`);
    if (!run.result.accepted) throw Error(JSON.stringify(run.result.failures));
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
