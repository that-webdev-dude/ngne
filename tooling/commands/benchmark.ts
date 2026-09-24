import { resolve } from "node:path";
import { content } from "../suites/benchmarks/content/run.js";

try {
    const args = process.argv.slice(2),
        seen = new Set<string>();
    const options: { manifest?: string; output?: string; smoke?: boolean } = {};
    for (let i = 0; i < args.length; i++) {
        const key = args[i];
        if (seen.has(key)) throw Error(`Duplicate option ${key}`);
        seen.add(key);
        if (key === "--explore") continue;
        if (key === "--smoke") {
            options.smoke = true;
            continue;
        }
        if (
            (key === "--manifest" || key === "--output") &&
            args[i + 1] &&
            !args[i + 1].startsWith("--")
        )
            options[key === "--manifest" ? "manifest" : "output"] = resolve(args[++i]);
        else throw Error(`Unknown or incomplete option ${key}`);
    }
    if (!seen.has("--explore"))
        throw Error(
            "Usage: benchmark --explore [--smoke] [--manifest exact-path] [--output fresh-path]. No controlled baseline is established.",
        );
    const run = await content(process.cwd(), options);
    console.log(`Engine resource measurement: ${run.evidence}`);
    if (!run.result.accepted) throw Error(JSON.stringify(run.result.failures));
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
