import { compatibility } from "../suites/compatibility.js";

try {
    const args = process.argv.slice(2);
    const flags = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i],
            value = args[i + 1];
        if (
            !["--consumer", "--revision", "--manifest", "--output"].includes(key) ||
            flags.has(key) ||
            !value ||
            value.startsWith("--")
        )
            throw Error(
                "Usage: compatibility --consumer <checkout> --revision <full-commit> [--manifest <exact-manifest>] [--output <new-directory>]",
            );
        flags.set(key, value);
    }
    const consumer = flags.get("--consumer"),
        revision = flags.get("--revision");
    if (!consumer || !revision)
        throw Error("Explicit consumer checkout and pinned revision are required");
    const run = await compatibility(process.cwd(), {
        consumer,
        revision,
        manifest: flags.get("--manifest"),
        output: flags.get("--output"),
    });
    console.log(`Compatibility evidence: ${run.evidence}`);
    if (!run.result.accepted) throw Error(JSON.stringify(run.result.failures));
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
