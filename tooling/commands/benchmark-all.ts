import { allBenchmarks } from "../suites/benchmarks/all.js";
import { benchmarkOptions } from "../suites/benchmarks/options.js";

try {
    const run = await allBenchmarks(
        process.cwd(),
        benchmarkOptions(process.argv.slice(2), process.cwd()),
    );
    console.log(`Benchmark run: ${run.root}`);
    if (!run.result.accepted) process.exitCode = 1;
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
