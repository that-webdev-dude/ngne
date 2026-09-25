# Tooling layout and safeguards

Updated 2026-09-25. The [completion plan](migration-plan.md) owns scope and the
[local tickets](jira-ticket-sequence.md) own execution. This document records
boundaries to preserve, not an additional feature backlog.
Current usage lives in [tooling/README.md](../../tooling/README.md).

## Ownership and layout

| Location            | Responsibility                                                                      |
| ------------------- | ----------------------------------------------------------------------------------- |
| `tooling/commands/` | Thin concrete command composition and argument handling.                            |
| `tooling/core/`     | Shared preparation, run lifecycle, servers and browser/process ownership.           |
| `tooling/evidence/` | Existing schemas, runtime validation, identities and reports.                       |
| `tooling/suites/`   | Verification assertions, benchmark workload/method/budgets, selected compatibility. |
| `tooling/fixtures/` | Engine-owned installed applications and deterministic resources.                    |
| `tooling/profiles/` | Existing observed-environment expectations.                                         |
| `tooling/tests/`    | Flat tooling test entries; nested data stays fixture data.                          |
| `tests/`            | Engine unit/contract tests and engine-only helpers.                                 |
| `out/`              | Ignored fresh run evidence and disposable execution state.                          |
| `docs/evidence/`    | Dated historical records, preserved with their limits.                              |

Reuse existing owners; move legacy helpers when their callers and replacement
checks are ready. Do not create empty directories, a plugin layer, a second
runner for diagnostics, or an engine API solely for tooling. Keep fixture code
on the installed public package. Preserve current Node/browser typechecking.

## Command and lifecycle contract

Standalone commands prepare their prerequisites. Aggregates compose the same
operations with one exact verified preparation where applicable; they cannot
skip validation merely because preparation was reused. Default verification and
CI are consumer-free. Benchmarks and compatibility are explicitly selected.

One invocation creates fresh output; reject an existing explicit destination.
No implicit latest-run lookup, stale prepared input or engine-source fallback.
Preserve original prepared inputs and use verified disposable copies for mutation
tests. Never delete historical outputs on startup.

The shared browser owner retains page/browser connections, event subscriptions,
deadlines, large profiler replies, tracing and snapshots. Suites own navigation,
assertions, warmup and sampling. External servers remain caller-owned.
Timeout does not imply cancellation or replay. Attempt all owned cleanup after
partial startup or failure; retain scenario and diagnostic failures independently.
Success is finalized only after required checks, cleanup and evidence publication.

Preserve the existing socket implementation and capability tests. Replacing the
transport or adding a dependency requires a separate demonstrated need.

## Evidence documents

Keep the existing `ngne-tooling` schema/version/documentType/runId envelope,
runtime validators and independent outcome fields. Preserve manifests, results,
reports, inventories, raw measurements and required logs/diagnostics already
produced. Legacy formats retain their own schemas; do not relabel old records.

Use contained relative paths for payload references, verify inventories and hashes,
and reject missing, changed, escaping or cross-run inputs. The inventory excludes
itself. Write progress atomically; final publication failure remains incomplete
and unsuccessful. Interrupted runs are not passed runs.

## Identity contract

Record separate identities for:

- Engine: actual filename returned by npm pack, tarball hash, installed engine contents.
- Workload: authored fixture source, deterministic generated assets, seed, non-engine dependency lock.
- Harness: executable runner, relevant shared modules, and configuration that affect the run.
- Build: compiled fixture outputs, separated from authored workload identity.
- Policy: workload parameters, instrumentation, warmup, sample counts, aggregation, budgets.
- Environment: Node, browser, OS, available hardware identifiers, adapter, flags, viewport, DPR, visibility and measurement conditions.

Revision and dirty-tree status are provenance, not substitutes for artifact identity. Define stable inventory ordering and hash algorithm. Fingerprint relevant transitive harness inputs so infrastructure changes are detectable.

Clean dedicated engine emission before packaging without deleting unrelated outputs. Verify installed package contents against the prepared artifact and verify fixture/build identities before execution. Preparation must reject source aliases or fallback resolution into engine source. A manifest path is an explicit handoff; archived portable evidence alone is not permission to resume a mutable workspace.

Named environment profiles express expectations. Verify observed values; a profile name alone establishes no equivalence. Missing required environment fields prevent accepted baseline comparison. Exploratory runs remain visibly separate.

## Result and measurement contract

Keep dimensions independent:

- Execution: pending, running, completed, failed, interrupted.
- Correctness: passed, failed, not evaluated.
- Budgets: passed, failed, not evaluated.
- Cleanup: pending, passed, failed.
- Evidence: partial, complete.

Required stages must complete and satisfy their applicable checks. Final success requires cleanup and complete evidence. Benchmark budget failure produces an unsuccessful acceptance outcome but may retain valid measurements for comparison. Incorrect workload behavior prevents accepted performance conclusions. Crashes, missing samples, identity mismatches, or cleanup failure invalidate performance acceptance.

Preserve scenario, diagnostic, and cleanup failures separately. A report leads with failures, evidence limitations, and comparability before metrics.

For each metric record name, unit, operation, sampling population/window, warmup, sample count, aggregation method, and instrumentation. Keep raw samples or explicitly declare omissions. Distinguish resource accounting, V8 heap, process memory, and GPU/driver memory. Separate physical-device, software-WebGPU, and manual visual/audible evidence.

## Comparison and legacy support

Relocate existing implementations without changing their semantics:

- Strict content comparison retains exact identities, passed acceptance and cleanup
  requirements. Missing identity is not invented.
- Aggregate comparison remains advisory, preserving warnings, problems, the 10%
  attention threshold, metric directions, scan precedence and JSON/Markdown outputs.
  An attention signal is neither a performance budget nor statistical significance.
- Reuse the two [existing legacy reader families and fixtures](legacy-formats.md).
  Preserve per-stage/consolidated/compact handling and tampering rejection.
  The aggregate runner's legacy projection remains an explicit comparison input.
- No new-format comparator, candidate mode, unified reader API, historical adapters
  or comparison schema is required. New installed-resource cross-revision comparisons
  remain unsupported. Independent budget outcomes do not change the old comparator.

## Evidence retention and CI delivery

Upload existing evidence needed to inspect each selected CI check, including failed
runs. Retain package/build identities, raw samples where produced, command logs and
cleanup outcomes. Document omitted optional payloads and local-only prerequisites.
No portable/resumable export claim follows from copying an evidence directory.

Do not upload node_modules, caches, browser profiles or disposable installations.
No exporter, new archive format or default/full export modes are required.
Preserve failed local evidence; any pruning must remain explicit and limited to
verified owned paths. Keep existing compaction validation and diagnostic retention.

Keep one ordinary Ubuntu verification job, the current correctness/failure checks
and the deployment dependency. Reuse verified preparations and avoid duplicate
uploads. Benchmarks stay explicit. Record the final CI result and investigate
demonstrated slowness; no five-run campaign, timing budget or topology redesign
is required. Preserve historical timing data without claiming cost acceptance.

## Consumer contract

The [consumer command contract](consumer-command-contract.md) is the sole detailed
owner of v1 invocation and response semantics. Preserve its validator and fixtures;
do not redefine the protocol during command cleanup.

Selection requires an explicit pinned consumer. No sibling discovery, embedded game
snapshot, consumer default or game-specific adapter. Validate every response,
including nonzero exits and partial publication; preserve original failures alongside
validation errors. Selected compatibility must pass required checks and cleanup;
unselected compatibility makes no claim.

## Migration and retirement

Use the existing inventory, coverage and retirement maps and checker described in
[the planning index](README.md). A path move includes callers, tests, configuration,
documentation and CI paths. Passing replacement checks and a live-reference audit
precede deletion; counts alone are not equivalent coverage.

Preserve historical evidence bytes/hashes and fix links when relocation is necessary.
Do not convert old measurements, prune user outputs or relax blocked retirement
gates. Keep supported compatibility entry points until their callers are accounted
for. New-format features excluded by the completion plan do not become deletion
prerequisites.
