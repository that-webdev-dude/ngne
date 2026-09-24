import { resolve } from "node:path";
import { content } from "../suites/benchmarks/content/run.js";

try {
    const args = process.argv.slice(2),
        seen = new Set<string>();
    const options: {
        manifest?: string;
        output?: string;
        smoke?: boolean;
        mode?: "exploratory" | "baseline" | "controlled";
        profile?: string;
        budget?: string;
    } = {};
    for (let i = 0; i < args.length; i++) {
        const key = args[i];
        if (seen.has(key)) throw Error(`Duplicate option ${key}`);
        seen.add(key);
        if (["--explore", "--baseline", "--controlled"].includes(key)) {
            if (options.mode) throw Error("Choose exactly one measurement mode");
            options.mode =
                key === "--explore"
                    ? "exploratory"
                    : key === "--baseline"
                      ? "baseline"
                      : "controlled";
            continue;
        }
        if (key === "--smoke") {
            options.smoke = true;
            continue;
        }
        if (
            (key === "--manifest" ||
                key === "--output" ||
                key === "--profile" ||
                key === "--budget") &&
            args[i + 1] &&
            !args[i + 1].startsWith("--")
        )
            options[key.slice(2) as "manifest" | "output" | "profile" | "budget"] =
                key === "--profile" ? args[++i] : resolve(args[++i]);
        else throw Error(`Unknown or incomplete option ${key}`);
    }
    if (!options.mode)
        throw Error(
            "Usage: benchmark --explore [--smoke] OR --baseline --profile name OR --controlled --profile name --budget exact-file; optional --manifest exact-path --output fresh-path.",
        );
    const run = await content(process.cwd(), options);
    console.log(`Engine resource measurement: ${run.evidence}`);
    if (!run.result.accepted) throw Error(JSON.stringify(run.result.failures));
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
