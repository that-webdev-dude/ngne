import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRun } from "./run-results.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    try {
        main();
    } catch (error) {
        console.error(
            `Benchmark comparison failed: ${error instanceof Error ? error.message : error}`,
        );
        process.exitCode = 1;
    }

function main() {
    const parsed = parseArguments(process.argv.slice(2));
    if (parsed.help || parsed.positionals.length !== 2) {
        printUsage();
        process.exitCode = parsed.help ? 0 : 1;
        return;
    }
    const baseline = loadRun(parsed.positionals[0], "baseline");
    const candidate = loadRun(parsed.positionals[1], "candidate");
    const outputDirectory = parsed.output
        ? resolveInputPath(parsed.output)
        : join(
              repositoryRoot,
              ".test-output",
              "comparisons",
              `${basename(baseline.directory)}--vs--${basename(candidate.directory)}-${timestamp()}`,
          );
    mkdirSync(outputDirectory, { recursive: true });
    const comparison = compareRuns(baseline, candidate, parsed.attentionPercent);
    const jsonPath = join(outputDirectory, "comparison.json");
    const reportPath = join(outputDirectory, "report.md");
    writeFileSync(jsonPath, JSON.stringify(comparison, null, 2) + "\n", "utf8");
    writeFileSync(reportPath, renderMarkdown(comparison, outputDirectory), "utf8");
    console.log(`Scan result: ${comparison.scanResult}`);
    console.log(`Definite problems: ${comparison.summary.problems}`);
    console.log(`Compatibility warnings: ${comparison.summary.compatibilityWarnings}`);
    console.log(`Notable regressions: ${comparison.summary.regressions}`);
    console.log(`Improvements: ${comparison.summary.improvements}`);
    console.log(`Report: ${reportPath}`);
    console.log(`JSON: ${jsonPath}`);
}

function parseArguments(args) {
    const result = { positionals: [], output: undefined, attentionPercent: 10, help: false };
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === "--help" || argument === "-h") {
            result.help = true;
        } else if (argument === "--output") {
            result.output = requiredValue(args, ++index, "--output");
        } else if (argument === "--attention-percent") {
            const value = Number(requiredValue(args, ++index, "--attention-percent"));
            if (!Number.isFinite(value) || value <= 0)
                throw new Error("--attention-percent must be greater than zero");
            result.attentionPercent = value;
        } else if (argument.startsWith("-")) {
            throw new Error(`Unknown option ${argument}`);
        } else {
            result.positionals.push(argument);
        }
    }
    return result;
}

function requiredValue(args, index, option) {
    const value = args[index];
    if (!value) throw new Error(`${option} requires a value`);
    return value;
}

function printUsage() {
    console.log(`Usage:
  npm run bench:compare -- <baseline-run> <candidate-run> [options]

Options:
  --output <directory>           Write the report to a specific directory
  --attention-percent <number>  Highlight changes at or above this percentage (default: 10)
  --help                         Show this help`);
}

function resolveInputPath(path) {
    return isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
}

export function compareRuns(baseline, candidate, attentionPercent = 10) {
    const compatibilityWarnings = [];
    const problems = [];
    const workloads = [];

    compareIdentity(
        compatibilityWarnings,
        "manifest",
        "schema version",
        baseline.manifest.schemaVersion,
        candidate.manifest.schemaVersion,
    );
    compareIdentity(
        compatibilityWarnings,
        "manifest",
        "machine",
        baseline.manifest.environment?.machine,
        candidate.manifest.environment?.machine,
    );
    compareIdentity(
        compatibilityWarnings,
        "manifest",
        "operating system",
        baseline.manifest.environment?.os,
        candidate.manifest.environment?.os,
    );
    compareIdentity(
        compatibilityWarnings,
        "manifest",
        "warmup duration",
        baseline.manifest.parameters?.warmupSeconds,
        candidate.manifest.parameters?.warmupSeconds,
    );
    compareIdentity(
        compatibilityWarnings,
        "manifest",
        "sample duration",
        baseline.manifest.parameters?.durationSeconds,
        candidate.manifest.parameters?.durationSeconds,
    );
    compareIdentity(
        compatibilityWarnings,
        "manifest",
        "diagnostics mode",
        baseline.manifest.parameters?.diagnostics,
        candidate.manifest.parameters?.diagnostics,
    );

    if (candidate.manifest.status !== "passed")
        problems.push({
            scope: "candidate",
            message: `Candidate run status is ${candidate.manifest.status}`,
        });
    for (const stage of candidate.manifest.stages ?? []) {
        if (stage.status === "failed")
            problems.push({ scope: stage.name, message: "Candidate stage failed" });
    }

    const baselineNames = new Set(baseline.results.keys());
    const candidateNames = new Set(candidate.results.keys());
    for (const name of baselineNames) {
        if (!candidateNames.has(name))
            compatibilityWarnings.push({
                scope: name,
                message: "Workload is missing from the candidate run",
            });
    }
    for (const name of candidateNames) {
        if (!baselineNames.has(name))
            compatibilityWarnings.push({
                scope: name,
                message: "Workload is missing from the baseline run",
            });
    }

    let comparedSharedBrowserEnvironment = false;
    for (const name of [...baselineNames].filter((value) => candidateNames.has(value)).sort()) {
        const baselineResult = baseline.results.get(name).value;
        const candidateResult = candidate.results.get(name).value;
        if (name === "cpu") {
            compareCpuEnvironment(compatibilityWarnings, baselineResult, candidateResult);
            inspectCpuProblems(problems, candidateResult);
        } else if (name === "churn" || name.startsWith("churn-")) {
            for (const field of ["node", "platform", "arch", "cpu", "parameters", "mode"])
                compareIdentity(
                    compatibilityWarnings,
                    name,
                    field,
                    baselineResult[field],
                    candidateResult[field],
                );
            for (const file of ["../../package-lock.json", "./churn-schema.ts"])
                compareIdentity(
                    compatibilityWarnings,
                    name,
                    file,
                    baselineResult.sourceHashes?.[file],
                    candidateResult.sourceHashes?.[file],
                );
        } else {
            compareBrowserEnvironment(
                compatibilityWarnings,
                name,
                baselineResult,
                candidateResult,
                !comparedSharedBrowserEnvironment,
            );
            comparedSharedBrowserEnvironment = true;
            inspectBrowserProblems(problems, name, candidateResult);
        }
        const metrics = metricDefinitions(name)
            .map((definition) =>
                compareMetric(definition, baselineResult, candidateResult, attentionPercent),
            )
            .filter(Boolean);
        workloads.push({
            name,
            baselineResult: baseline.results.get(name).path,
            candidateResult: candidate.results.get(name).path,
            metrics,
        });
    }

    const allMetrics = workloads.flatMap((workload) =>
        workload.metrics.map((metric) => ({ workload: workload.name, ...metric })),
    );
    const regressions = allMetrics
        .filter((metric) => metric.direction === "attention")
        .sort((left, right) => metricScore(right) - metricScore(left));
    const improvements = allMetrics
        .filter((metric) => metric.direction === "improvement")
        .sort((left, right) => metricScore(right) - metricScore(left));
    const stable = allMetrics.filter((metric) => metric.direction === "stable");
    const scanResult = problems.length
        ? "NEEDS ATTENTION"
        : compatibilityWarnings.length
          ? "CHECK COMPARABILITY"
          : regressions.length
            ? "REVIEW REGRESSIONS"
            : improvements.length
              ? "NO DEFINITE PROBLEMS; IMPROVEMENTS DETECTED"
              : "NO NOTABLE MOVEMENT";

    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        scanResult,
        attentionPercent,
        baseline: runIdentity(baseline),
        candidate: runIdentity(candidate),
        summary: {
            problems: problems.length,
            compatibilityWarnings: compatibilityWarnings.length,
            regressions: regressions.length,
            improvements: improvements.length,
            stable: stable.length,
        },
        problems,
        compatibilityWarnings,
        regressions,
        improvements,
        workloads,
        note: "Attention markers show directional evidence, not an automatic performance pass or failure. Repeat important comparisons under controlled conditions.",
    };
}

function runIdentity(run) {
    return {
        directory: run.directory,
        manifest: run.manifestPath,
        revision: run.manifest.revision,
        startedAt: run.manifest.startedAt,
        status: run.manifest.status,
        parameters: run.manifest.parameters,
        environment: run.manifest.environment,
    };
}

function compareCpuEnvironment(warnings, baseline, candidate) {
    for (const [label, path] of [
        ["Node version", "environment.node"],
        ["platform", "environment.platform"],
        ["architecture", "environment.arch"],
        ["CPU", "environment.cpu"],
        ["logical core count", "environment.logicalCores"],
    ]) {
        compareIdentity(
            warnings,
            "cpu",
            label,
            getValue(baseline, path),
            getValue(candidate, path),
        );
    }
}

function compareBrowserEnvironment(warnings, name, baseline, candidate, compareShared) {
    for (const [label, path] of [
        ["workload", "workload"],
        ["page backend", "backend.pageContext"],
    ]) {
        compareIdentity(warnings, name, label, getValue(baseline, path), getValue(candidate, path));
    }
    if (compareShared) {
        for (const [label, path] of [
            ["browser", "observedBrowser.product"],
            ["GPU vendor", "gpu.vendor"],
            ["GPU architecture", "gpu.architecture"],
            ["GPU device", "gpu.device"],
            ["fallback adapter", "gpu.isFallbackAdapter"],
            ["device pixel ratio", "devicePixelRatio"],
            ["viewport", "viewport"],
        ]) {
            compareIdentity(
                warnings,
                "browser environment",
                label,
                getValue(baseline, path),
                getValue(candidate, path),
            );
        }
    }
    if (name.startsWith("renderer-webgpu")) {
        for (const [label, path] of [
            ["renderer mode", "rendererEvidence.metadata.mode"],
            ["alternating-texture mode", "rendererEvidence.metadata.alternating"],
            ["sprite count", "rendererEvidence.metadata.sprites"],
            ["surface width", "rendererEvidence.metadata.width"],
            ["surface height", "rendererEvidence.metadata.height"],
            ["draw calls", "rendererEvidence.metrics.drawCalls"],
            ["upload bytes", "rendererEvidence.metrics.uploadBytes"],
            ["bindings", "rendererEvidence.metrics.bindings"],
        ]) {
            compareIdentity(
                warnings,
                name,
                label,
                getValue(baseline, path),
                getValue(candidate, path),
            );
        }
    }
}

function compareIdentity(warnings, scope, label, baseline, candidate) {
    if (JSON.stringify(baseline) !== JSON.stringify(candidate)) {
        warnings.push({
            scope,
            message: `${label} differs: baseline ${displayIdentity(baseline)}, candidate ${displayIdentity(candidate)}`,
        });
    }
}

function displayIdentity(value) {
    if (value === undefined) return "<missing>";
    return JSON.stringify(value);
}

function inspectCpuProblems(problems, candidate) {
    if (candidate.collisionGrid?.valid !== true)
        problems.push({
            scope: "cpu",
            message: "Collision-grid timing did not clear its timer-resolution validity threshold",
        });
}

function inspectBrowserProblems(problems, name, candidate) {
    if (candidate.pageError)
        problems.push({ scope: name, message: `Page error: ${candidate.pageError}` });
    if (candidate.rendererEvidence?.error)
        problems.push({
            scope: name,
            message: `Renderer error: ${candidate.rendererEvidence.error}`,
        });
    if (
        candidate.visibilityState?.atStart !== "visible" ||
        candidate.visibilityState?.atEnd !== "visible" ||
        candidate.visibilityChanges?.length
    )
        problems.push({
            scope: name,
            message: "Page was not continuously visible during sampling",
        });
    if (candidate.gpu?.isFallbackAdapter || candidate.backend?.adapter?.isFallbackAdapter)
        problems.push({ scope: name, message: "Candidate used a fallback GPU adapter" });
    if (candidate.run?.survivingOwnedProcesses?.length)
        problems.push({ scope: name, message: "Benchmark-owned processes survived cleanup" });
}

function metricDefinitions(name) {
    if (name === "cpu") return cpuMetrics();
    if (name === "churn")
        return ["p50", "p95", "p99"].map((key) =>
            metric(`Churn batch ${key}`, `batchMs.${key}`, "ms"),
        );
    if (name === "churn-alloc")
        return [
            {
                ...metric(
                    "Sampled allocation per batch (descriptive)",
                    "allocation.sampledBytesPerBatch",
                    "bytes/batch",
                ),
                descriptive: true,
            },
            {
                ...metric(
                    "Sampled allocation rate (throughput-dependent)",
                    "allocation.sampledBytesPerBatchSecond",
                    "bytes/s",
                ),
                descriptive: true,
            },
        ];
    if (name === "churn-gc")
        return [
            metric("GC pause total", "gcTrace.windowPauseTotalMs", "ms"),
            {
                ...metric("GC count (descriptive)", "gcTrace.windowCount", "count"),
                descriptive: true,
            },
        ];
    const definitions = browserMetrics();
    if (name.startsWith("renderer-webgpu")) definitions.push(...rendererMetrics());
    return definitions;
}

function cpuMetrics() {
    return [
        metric("ECS p50", "ecs.ms.p50", "ms"),
        metric("ECS p95", "ecs.ms.p95", "ms"),
        metric("ECS p99", "ecs.ms.p99", "ms"),
        metric("Chaos CPU p50", "chaos.simulationAndPreparationMs.p50", "ms"),
        metric("Chaos CPU p95", "chaos.simulationAndPreparationMs.p95", "ms"),
        metric("Chaos CPU p99", "chaos.simulationAndPreparationMs.p99", "ms"),
        metric("Chaos ticks over budget", "chaos.ticksOverBudget", "count", true),
        metric(
            "Collision-grid p50",
            "collisionGrid.schemaViewRow.nsPerCandidateCheck.p50",
            "ns/check",
        ),
        metric(
            "Collision-grid p95",
            "collisionGrid.schemaViewRow.nsPerCandidateCheck.p95",
            "ns/check",
        ),
        metric(
            "Collision-grid p99",
            "collisionGrid.schemaViewRow.nsPerCandidateCheck.p99",
            "ns/check",
        ),
        metric("First epoch traversal p50", "epochTraversal.firstTraversalAfterCommitMs.p50", "ms"),
        metric("First epoch traversal p95", "epochTraversal.firstTraversalAfterCommitMs.p95", "ms"),
        metric("First epoch traversal p99", "epochTraversal.firstTraversalAfterCommitMs.p99", "ms"),
        metric("Same-epoch traversal p50", "epochTraversal.secondTraversalSameEpochMs.p50", "ms"),
        metric("Same-epoch traversal p95", "epochTraversal.secondTraversalSameEpochMs.p95", "ms"),
        metric("Paired epoch delta p50", "epochTraversal.pairedDeltaMs.p50", "ms"),
        metric("Paired epoch delta p95", "epochTraversal.pairedDeltaMs.p95", "ms"),
    ];
}

function browserMetrics() {
    return [
        metric("Frame callback p50", "frameCallbackMs.p50", "ms"),
        metric("Frame callback p95", "frameCallbackMs.p95", "ms"),
        metric("Frame callback p99", "frameCallbackMs.p99", "ms"),
        metric("Frame interval p95", "frameIntervalMs.p95", "ms"),
        metric("Frame interval p99", "frameIntervalMs.p99", "ms"),
        metric("Frame interval max", "frameIntervalMs.max", "ms"),
        metric("Intervals over 25 ms", "intervalsOver25Ms", "count", true),
        metric("Intervals over 50 ms", "intervalsOver50Ms", "count", true),
        metric("Long tasks in sample", "longTasksInSample", "count", true),
        metric("Dropped ticks", "droppedTicks.duringSample", "count", true),
        derivedMetric(
            "Retained heap growth",
            (result) =>
                result.retainedHeapMiBAfterForcedGc?.afterRun -
                result.retainedHeapMiBAfterForcedGc?.afterWarmup,
            "MiB",
        ),
        metric("Retained heap after run", "retainedHeapMiBAfterForcedGc.afterRun", "MiB"),
        metric("Sampled allocations", "allocation.sampledBytesPerSecond", "bytes/s"),
    ];
}

function rendererMetrics() {
    return [
        metric("Renderer preparation p50", "rendererEvidence.cpuPreparationMs.p50", "ms"),
        metric("Renderer preparation p95", "rendererEvidence.cpuPreparationMs.p95", "ms"),
        metric("Renderer preparation p99", "rendererEvidence.cpuPreparationMs.p99", "ms"),
        metric("Renderer submission p50", "rendererEvidence.cpuSubmissionMs.p50", "ms"),
        metric("Renderer submission p95", "rendererEvidence.cpuSubmissionMs.p95", "ms"),
        metric("Renderer submission p99", "rendererEvidence.cpuSubmissionMs.p99", "ms"),
        metric("Renderer total p50", "rendererEvidence.cpuTotalMs.p50", "ms"),
        metric("Renderer total p95", "rendererEvidence.cpuTotalMs.p95", "ms"),
        metric("Renderer total p99", "rendererEvidence.cpuTotalMs.p99", "ms"),
    ];
}

function metric(label, path, unit, zeroSensitive = false) {
    return { label, path, unit, zeroSensitive, read: (result) => getValue(result, path) };
}

function derivedMetric(label, read, unit) {
    return { label, path: null, unit, zeroSensitive: false, read };
}

function compareMetric(definition, baseline, candidate, attentionPercent) {
    const baselineValue = Number(definition.read(baseline));
    const candidateValue = Number(definition.read(candidate));
    if (!Number.isFinite(baselineValue) || !Number.isFinite(candidateValue)) return null;
    const absoluteDelta = candidateValue - baselineValue;
    const deltaPercent =
        baselineValue === 0 ? null : (absoluteDelta / Math.abs(baselineValue)) * 100;
    let direction = "stable";
    if (definition.zeroSensitive) {
        if (candidateValue > baselineValue) direction = "attention";
        else if (candidateValue < baselineValue) direction = "improvement";
    } else if (deltaPercent === null) {
        if (absoluteDelta > 0) direction = "attention";
        else if (absoluteDelta < 0) direction = "improvement";
    } else if (deltaPercent + 1e-9 >= attentionPercent) {
        direction = "attention";
    } else if (deltaPercent - 1e-9 <= -attentionPercent) {
        direction = "improvement";
    }
    if (definition.descriptive) direction = "descriptive";
    return {
        label: definition.label,
        unit: definition.unit,
        baseline: baselineValue,
        candidate: candidateValue,
        absoluteDelta,
        deltaPercent,
        direction,
    };
}

function getValue(object, path) {
    let current = object;
    for (const segment of path.split(".")) {
        if (current === null || current === undefined || !(segment in Object(current)))
            return undefined;
        current = current[segment];
    }
    return current;
}

function metricScore(metric) {
    return metric.deltaPercent === null
        ? Math.abs(metric.absoluteDelta) * 1000
        : Math.abs(metric.deltaPercent);
}

function renderMarkdown(comparison, outputDirectory) {
    const lines = [
        "# NGNE benchmark comparison",
        "",
        `> Scan result: **${comparison.scanResult}**`,
        "",
        `- Baseline: revision \`${shortRevision(comparison.baseline.revision)}\`, ${comparison.baseline.startedAt}`,
        `- Candidate: revision \`${shortRevision(comparison.candidate.revision)}\`, ${comparison.candidate.startedAt}`,
        `- Attention threshold: ${formatNumber(comparison.attentionPercent)}%`,
        `- Baseline run: [summary](${markdownPath(outputDirectory, join(comparison.baseline.directory, "summary.md"))})`,
        `- Candidate run: [summary](${markdownPath(outputDirectory, join(comparison.candidate.directory, "summary.md"))})`,
        "",
        "| Definite problems | Compatibility warnings | Notable regressions | Improvements |",
        "| ---: | ---: | ---: | ---: |",
        `| ${comparison.summary.problems} | ${comparison.summary.compatibilityWarnings} | ${comparison.summary.regressions} | ${comparison.summary.improvements} |`,
        "",
        "Attention markers show direction, not an automatic performance failure. Repeat important comparisons under controlled conditions.",
        "",
        "## Needs attention",
        "",
    ];

    renderListSection(
        lines,
        "Definite problems",
        comparison.problems,
        "No definite problems detected.",
    );
    renderListSection(
        lines,
        "Compatibility warnings",
        comparison.compatibilityWarnings,
        "Benchmark environments and configurations match.",
    );
    lines.push("### Largest regressions", "");
    renderMetricTable(
        lines,
        comparison.regressions.slice(0, 10),
        "No metrics crossed the attention threshold.",
    );
    lines.push("## Largest improvements", "");
    renderMetricTable(
        lines,
        comparison.improvements.slice(0, 10),
        "No metrics crossed the improvement threshold.",
    );
    lines.push("## Workloads", "");
    for (const workload of comparison.workloads) {
        lines.push(
            `### ${workload.name}`,
            "",
            `[Baseline JSON](${markdownPath(outputDirectory, workload.baselineResult)}) | [Candidate JSON](${markdownPath(outputDirectory, workload.candidateResult)})`,
            "",
            "| Metric | Baseline | Candidate | Change | Direction |",
            "| --- | ---: | ---: | ---: | --- |",
        );
        for (const metric of workload.metrics) {
            lines.push(metricRow(metric));
        }
        lines.push("");
    }
    return lines.join("\n") + "\n";
}

function renderListSection(lines, title, entries, emptyMessage) {
    lines.push(`### ${title}`, "");
    if (!entries.length) {
        lines.push(emptyMessage, "");
        return;
    }
    for (const entry of entries)
        lines.push(`- **${escapeMarkdown(entry.scope)}:** ${escapeMarkdown(entry.message)}`);
    lines.push("");
}

function renderMetricTable(lines, metrics, emptyMessage) {
    if (!metrics.length) {
        lines.push(emptyMessage, "");
        return;
    }
    lines.push(
        "| Workload | Metric | Baseline | Candidate | Change |",
        "| --- | --- | ---: | ---: | ---: |",
    );
    for (const metric of metrics) {
        lines.push(
            `| ${escapeMarkdown(metric.workload)} | ${escapeMarkdown(metric.label)} | ${formatValue(metric.baseline, metric.unit)} | ${formatValue(metric.candidate, metric.unit)} | ${formatDelta(metric)} |`,
        );
    }
    lines.push("");
}

function metricRow(metric) {
    return `| ${escapeMarkdown(metric.label)} | ${formatValue(metric.baseline, metric.unit)} | ${formatValue(metric.candidate, metric.unit)} | ${formatDelta(metric)} | **${metric.direction.toUpperCase()}** |`;
}

function formatValue(value, unit) {
    if (unit === "count") return `${Math.round(value)}`;
    if (unit === "bytes/s") return `${Math.round(value).toLocaleString("en-US")} ${unit}`;
    return `${formatNumber(value)} ${unit}`;
}

function formatDelta(metric) {
    const absolute = `${metric.absoluteDelta >= 0 ? "+" : ""}${formatNumber(metric.absoluteDelta)} ${metric.unit}`;
    if (metric.deltaPercent === null) return absolute;
    return `${metric.deltaPercent >= 0 ? "+" : ""}${formatNumber(metric.deltaPercent)}%`;
}

function formatNumber(value) {
    return Number(value.toFixed(3)).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function markdownPath(fromDirectory, target) {
    return relative(fromDirectory, target).replaceAll("\\", "/").replaceAll(" ", "%20");
}

function escapeMarkdown(value) {
    return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function shortRevision(revision) {
    return revision ? revision.slice(0, 8) : "unknown";
}

function timestamp() {
    return new Date()
        .toISOString()
        .replaceAll(":", "-")
        .replace(/\.\d{3}Z$/, "Z");
}
