import type { Manifest, Result } from "./schema.js";

export function report(manifest: Manifest, result: Result): string {
    return [
        `# ${manifest.suite}`,
        "",
        `Run: ${manifest.runId}`,
        `Accepted: ${result.accepted}`,
        "",
        ...result.failures.map((failure) => `- ${failure.kind}: ${failure.message}`),
        "",
        `Execution: ${result.execution}; correctness: ${result.correctness}; budgets: ${result.budgets}; cleanup: ${result.cleanup}; evidence: ${result.evidence}.`,
        "",
        "Evidence applies only to the selected suite and recorded environment. It does not establish controlled run comparability or manual visual/audio confirmation. Compatibility was not selected.",
        "",
        ...result.stages.map(
            (stage) =>
                `- ${stage.id}: ${stage.execution}, correctness ${stage.correctness}, budgets ${stage.budgets}`,
        ),
        "",
        "[Manifest](manifest.json) · [Result](result.json)",
        ...(manifest.suite === "benchmarks"
            ? [
                  "",
                  "Exploratory internal-source measurements; no controlled performance claim.",
                  ...result.stages
                      .filter(
                          (stage) =>
                              !stage.id.startsWith("build-") && stage.correctness === "passed",
                      )
                      .map(
                          (stage) =>
                              `- [${stage.id} measurements](stages/${stage.id}/measurements.json)`,
                      ),
              ]
            : []),
        "",
    ].join("\n");
}
