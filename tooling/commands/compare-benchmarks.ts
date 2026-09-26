import { main } from "../evidence/compare-runs.mjs";
import { loadBenchmarkRun } from "../evidence/benchmark-results.js";

try {
    main(loadBenchmarkRun);
} catch (error) {
    console.error(`Benchmark comparison failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
}
