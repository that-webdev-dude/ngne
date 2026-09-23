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
        "This preparation record establishes package/build identity, not browser behavior or performance comparability. Compatibility was not selected.",
        "",
        ...result.stages.map(
            (stage) => `- ${stage.id}: ${stage.execution}, correctness ${stage.correctness}`,
        ),
        "",
        "[Manifest](manifest.json) · [Result](result.json)",
        "",
    ].join("\n");
}
