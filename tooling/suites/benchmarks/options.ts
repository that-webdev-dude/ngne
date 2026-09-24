import { resolve } from "node:path";

export interface BenchmarkOptions {
    warmupSeconds: number;
    durationSeconds: number;
    baseCdpPort: number;
    baseUrl: string;
    outputRoot: string;
    diagnostics: boolean;
    compact: boolean;
    skipBuild: boolean;
    workload: "all" | "churn";
}

/** Original orchestration flags remain aliases; reject ambiguous or misspelled input. */
export function benchmarkOptions(args: string[], root: string): BenchmarkOptions {
    const value: BenchmarkOptions = {
        warmupSeconds: 10,
        durationSeconds: 60,
        baseCdpPort: 9333,
        baseUrl: "http://127.0.0.1:4173",
        outputRoot: resolve(root, "out/runs"),
        diagnostics: false,
        compact: false,
        skipBuild: false,
        workload: "all",
    };
    const aliases: Record<string, keyof BenchmarkOptions> = {
        "-WarmupSeconds": "warmupSeconds",
        "--warmup-seconds": "warmupSeconds",
        "-DurationSeconds": "durationSeconds",
        "--duration-seconds": "durationSeconds",
        "-BaseCdpPort": "baseCdpPort",
        "--base-cdp-port": "baseCdpPort",
        "-BaseUrl": "baseUrl",
        "--base-url": "baseUrl",
        "-OutputRoot": "outputRoot",
        "--output-root": "outputRoot",
        "-Diagnostics": "diagnostics",
        "--diagnostics": "diagnostics",
        "-Compact": "compact",
        "--compact": "compact",
        "-SkipBuild": "skipBuild",
        "--skip-build": "skipBuild",
        "-Workload": "workload",
        "--workload": "workload",
    };
    const seen = new Set<string>();
    for (let i = 0; i < args.length; i++) {
        const key = aliases[args[i]];
        if (!key || seen.has(key)) throw Error(`Unknown or duplicate option ${args[i]}`);
        seen.add(key);
        if (key === "diagnostics" || key === "compact" || key === "skipBuild") value[key] = true;
        else {
            const input = args[++i];
            if (!input || input.startsWith("-")) throw Error(`Missing ${key}`);
            if (key === "warmupSeconds" || key === "durationSeconds" || key === "baseCdpPort") {
                const number = Number(input);
                const [min, max] =
                    key === "warmupSeconds"
                        ? [0, 3600]
                        : key === "durationSeconds"
                          ? [1, 86400]
                          : [1024, 65531];
                if (!Number.isSafeInteger(number) || number < min || number > max)
                    throw Error(`Invalid ${key}`);
                value[key] = number;
            } else if (key === "workload") {
                if (input !== "all" && input !== "churn")
                    throw Error("Workload must be all or churn");
                value.workload = input;
            } else value[key] = input;
        }
    }
    const url = new URL(value.baseUrl);
    if (
        !["http:", "https:"].includes(url.protocol) ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
    )
        throw Error(
            "Base URL must be an absolute HTTP(S) URL without credentials, query or fragment",
        );
    value.baseUrl = value.baseUrl.replace(/\/+$/, "");
    value.outputRoot = resolve(root, value.outputRoot);
    return value;
}
