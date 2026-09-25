# Tooling completion plan

Scope approved 2026-09-25. This is the owner of remaining migration scope.
[Local tickets](jira-ticket-sequence.md) define each task's changes and checks;
[layout and safeguards](layout-and-evidence-contracts.md) define what those changes
must preserve. Current commands belong in [tooling/README.md](../../tooling/README.md).

## Objective

Finish consolidating the existing tooling so a clean NGNE checkout can verify its
installed package without a consumer repository. Keep benchmarks explicit and
consumer compatibility separately selected. Preserve public engine APIs.

The existing package preparation, run lifecycle, browser session, process cleanup
and evidence validation are the shared foundation. Ordinary and diagnostic runs
use the same owners and failure rules. Do not introduce simple/advanced runners,
duplicate validation paths, or a new framework.

## Remaining work

| Ticket | Deliverable                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------- |
| T7     | Move existing strict/advisory comparators and required readers into tooling without changing behavior.   |
| T8     | Finish a thin local verification command and ordinary CI artifact delivery using existing operations.    |
| T9     | Remove superseded implementations after their replacement checks pass; repair callers and documentation. |
| T10    | Verify the final layout locally and in ordinary Linux CI, and record the remaining limits.               |

Execute one ticket at a time. T6 is complete under the approved Linux benchmark
exclusion, using historical Windows evidence. T7 is complete on 2026-09-25: existing comparators/readers relocated with unchanged
semantics; 19 affected tests, 16 migration-checker tests, typechecks, formatting
and migration validation passed locally on Windows. T8 is next and has not started.

## Required safeguards

- Reuse exact verified prepared manifests; no latest-run lookup or source fallback.
- Keep package/install/build identities, schema checks and artifact integrity checks.
- Preserve deterministic assertions, existing benchmark samples and diagnostics.
- Required failures, partial evidence and failed cleanup cannot become success.
- Finalize after owned process/server/profile cleanup, including partial startup.
- Preserve independent execution, correctness, budget and cleanup outcomes already
  emitted by the runners. Do not change legacy comparator acceptance semantics.
- Keep default verification consumer-free. Explicit compatibility requires a pinned
  consumer and validates every response, including failures.
- Preserve existing environment/profile checks. Software GPU, physical GPU and
  manual observations remain distinct; historical results are not fresh validation.
- Keep the inventory/checker and existing retirement gates consistent with moves.
  Do not invent new ledgers, waive missing replacement checks or erase obligations.
- Preserve old outputs and historical evidence. Never reset, clean or restore old
  evidence as live prepared input.

## Out of scope

- Linux benchmark execution, including final acceptance. Ordinary Linux CI
  verification remains required; Linux benchmark portability is not established.
- New-format repeatability/candidate comparison, workload/build identity redesign,
  unified comparator APIs, new comparison schemas and historical conversion.
  Existing aggregate advisory scans remain usable through the legacy projection;
  new installed-resource cross-revision comparison is not delivered.
- A portable exporter, default/full export modes, new archive schemas or offline
  reproduction. Upload existing evidence and document retained/omitted payloads.
- Five matched final CI timing runs, the proposed 20% timing gate, baseline
  remeasurement and a new benchmark campaign. Preserve the existing timing record
  as history; investigate concrete slowness without claiming a measured speedup.
- Speculative target splitting, plugin infrastructure, new dependencies, engine
  API changes or external consumer implementation work.

These exclusions remove planned features and campaigns, not existing validation.
No easy mode may bypass checks; diagnostic flags may add observations only.

## Completion

The remaining tickets pass their stated checks, existing comparison behavior is
preserved, selected commands work twice without manual cleanup, ordinary Linux CI
passes, and superseded active tooling has no remaining callers. Keep one ordinary
verification job and its deployment dependency; missing hosted execution is a
reported blocker, not a pass.

Reuse historical consumer conformance when its runner, contract and relevant
inputs are unchanged. If they change, rerun the affected tests and explicitly
selected integration with authorized inputs; do not silently waive that gap.
No new performance claim, fresh Windows benchmark claim or Linux benchmark claim
follows from this documentation change.

Publishing, hosted dispatch, consumer edits, Jira changes, commits, pushes, merges
and deployment require their applicable authorization. This plan starts none of them.
