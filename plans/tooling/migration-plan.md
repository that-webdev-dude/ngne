> Adopted for implementation under plans/tooling/. Original review-pack location statements below are historical; local links target this adopted pack. See [planning records](README.md) for current adoption status.

# Engine verification and runner separation

Status: proposed for review; implementation has not started. This file is part of an external review pack, not repository-authoritative documentation. Detailed extraction, consumer interface, legacy scope, CI budget, and adoption decisions are in [layout and evidence contracts](layout-and-evidence-contracts.md); implementation sequence is in the [ticket proposal](jira-ticket-sequence.md).
Date: 2026-09-22
Repository: `C:\Users\jfabi\Documents\Projects\tests\ngne`

## Objective

Give NGNE its own installed-package verification fixture and benchmark workloads. Move Town/Dungeon acceptance and transition measurements to the consumer repository. Consolidate browser lifecycle infrastructure behind a small internal interface.

A clean engine checkout, after dependency installation and documented browser prerequisites, must validate its current package and run engine benchmarks with all external consumers absent. Default verification, aggregate engine verification, and default engine CI must neither fetch nor require an external consumer checkout, artifact, or embedded game snapshot. Commands must run twice without manual cleanup. Game-mechanics changes must require no engine-tooling edits.

## Scope and constraints

- Preserve public engine contracts and package exports. Do not introduce engine APIs solely for test convenience.
- Keep game schemas, controls, saves, collision rules, sessions, and progression consumer-owned.
- Keep existing deterministic and browser tests where they verify engine contracts; the installed fixture adds package-boundary evidence.
- Preserve historical evidence and identify its original workload, artifacts, environment, and limits. New workloads require new baselines.
- Retain Town/Dungeon coverage temporarily through explicitly selected migration checks until replacement engine and consumer coverage passes. Remove that dependency from default commands and CI before final acceptance; no permanent Town/Dungeon runner or special case remains.
- Keep this work local until implementation and any external actions are separately authorized. This plan does not authorize implementation, publication, deployment, or consumer-repository changes.

## Current findings

- `tests/browser-content-checks.ts` includes engine lifecycle assertions alongside consumer controls, saves, sessions, and progression checks.
- `tests/installed-content.mjs` unpacks an archived consumer, assumes a prior engine build, uses a fixed output location, and hardcodes the tarball filename.
- `tests/installed-browser.mjs` reads a manifest and checks fixture metadata, but does not verify installed/build file identities before execution.
- `benchmarks/content/run.mjs` uses a sibling consumer's existing package, installation, source, and build. Recording engine HEAD does not establish that the measured package came from that checkout.
- `benchmarks/content/fixtures.mjs` generates churn by modifying Town/Dungeon content schemas.
- `benchmarks/browser/browser-baseline.ts` retains separate CDP transport, WebSocket framing, and process cleanup. Its transport documents a 4.26 MB heap-profiler reply failure with Node 24's built-in WebSocket; current shared transport defaults to that built-in implementation.
- Build scripts combine several targets, Node runners lack comprehensive typechecking, and `bench:all` uses PowerShell.
- Content comparison requires identical artifacts, supporting repeatability but rejecting engine-change comparisons.

These findings come from source inspection, not new runtime verification.

## External consumer boundary and epic order

Complete this tooling epic, including final acceptance, before starting the next planned epics. Keep its scope bounded to the stated requirements rather than speculative future consumer needs.

NGNE owns minimal engine-only fixtures, package verification, controlled benchmarks, execution infrastructure, and evidence validation. External consumers own gameplay, content schemas, scenarios, acceptance checks, and consumer configuration. Any explicitly supplied consumer implementing the versioned command contract must work through the same compatibility runner without NGNE code changes. This requires a small command interface, not a generic plugin framework.

Compatibility is optional to select and mandatory to pass when selected. Missing inputs, failed checks, invalid evidence, and cleanup failures fail that selected run; no silent skip or fallback is allowed. Ordinary engine verification does not select a consumer and makes no consumer-compatibility claim.

Town/Dungeon demonstrates the external contract during migration; it is not a built-in fixture or a dependency of the completed tooling. Epic completion requires one real explicit integration proof separately from independent engine acceptance. This does not make that consumer a default CI or runtime dependency.

## 1. Map coverage and ownership

Inventory existing installed-content, browser-content, save, session, progression, and content-benchmark checks. For each assertion or measurement, record its current location, intended owner, replacement evidence, and retirement gate.

| Concern                                                                                      | Owner                          |
| -------------------------------------------------------------------------------------------- | ------------------------------ |
| Public imports, emitted declarations, package contents                                       | NGNE installed fixture         |
| Asset loading, retention, cancellation, scene lifecycle, rendering recovery, audio lifecycle | NGNE verification              |
| Controls, game collision rules, saves, sessions, progression, checkpoint behavior            | Consumer acceptance            |
| Controlled asset churn and engine resource accounting                                        | NGNE benchmark workload        |
| Town/Dungeon transitions and gameplay timing                                                 | Consumer benchmarks            |
| Browser discovery, launch, readiness, CDP lifecycle, diagnostics, owned-process cleanup      | Internal runner infrastructure |

T1a adopts the pack, inventories surfaces, adds the migration checker, and updates RULES.md, npm test discovery and initial tooling typechecking with its first regression tests. It freezes the pre-migration revision/workflow hash. T1b runs alongside T2 and delivers the consumer validator/conformance fixtures, bounded legacy fixtures and measured CI baseline. See the ticket proposal for separate completion gates.

Gate: no check is deleted until equivalent coverage has a named owner and has passed in its replacement location. Assertion counts alone do not establish equivalence.

## 2. Separate package preparation and create isolated runs

Introduce a package-only build before changing installed verification. Clean the dedicated engine emission directory before compilation so obsolete emitted files cannot enter the tarball. Preserve unrelated outputs.

Extract lifecycle and identity handling from benchmarks/content/run.mjs and fixtures.mjs, retaining existing cleanup safeguards. Add the missing shared package preparation operation that:

1. Allocates a unique run directory without overwriting previous runs.
2. Writes an initial manifest with schema version, run ID, revision, working-tree status, toolchain, and preparation state.
3. Builds the current package, runs `npm pack --json`, and uses the returned filename.
4. Checks required package contents and installs the tarball into an isolated fixture directory using declared dependencies and a reproducible dependency policy.
5. Records tarball hash, installed file identities, fixture inputs, dependency/toolchain identity, and root/nested build identities.
6. Records preparation success or failure and retains available logs and outputs.

Pass the exact manifest path to downstream validation. Do not discover a run through a fixed directory or implicit latest-success fallback. Verify identities before execution and before making disposable copies for fault injection. Reject incomplete preparation, changed artifacts, and reused explicit output destinations.

Standalone commands prepare their prerequisites. Aggregate commands may reuse the exact verified manifest to avoid rebuilding between stages.

Gate: two consecutive runs succeed independently; a deliberately stale emission file cannot survive packaging; tampered or incomplete artifacts are rejected; failed preparation retains diagnostics.

## 3. Introduce the engine-owned installed fixture

Create a small readable source fixture in the repository. It imports only the installed package's public surface and compiles against emitted declarations. Its configuration must not inherit the root `ngne` source alias or otherwise resolve engine source files.

Exercise:

- Public runtime imports and declaration usage, including relevant API misuse checks.
- External image/audio assets and root/nested URL bases.
- Successful preparation, failed preparation, cancellation, replacement, and disposal.
- Resource ownership, retention, and release accounting.
- Rendering and recovery through the ordinary browser path.
- Audio activation, playback evidence, transitions, stopping, and disposal.

Use controlled scenes and assets without game progression or persistence. Keep instrumentation fixture-owned and avoid expanding engine exports. Report browser/device evidence separately from software WebGPU and manual audible/visual confirmation.

Gate: installed verification passes without Town/Dungeon files or a sibling checkout, and the coverage map confirms preservation of engine assertions.

## 4. Separate consumer acceptance

Move game-specific assertions and transition measurements to the consumer repository. Implement the tarball/hash/output v1 command frozen in T1b and report the selected package identity. Every NGNE compatibility invocation validates the returned evidence through the versioned consumer-contract-v1 validator and conformance fixture set; record their identities. Invalid schema, mismatched run/package identities, corrupt artifact inventories or escaping paths fail the gate even when the consumer exits zero. Preserve original failures alongside validation diagnostics.

During migration, retain Town/Dungeon coverage as an explicitly supplied, pinned input to the consumer-neutral compatibility command and migration CI. Document its consumer revision and execution inputs. Remove consumer execution from the default engine suite and default CI once replacement engine and consumer checks pass. This removal is required before final acceptance.

Follow T1b's agreed interface and document the selected compatibility source at this stage: a pinned consumer artifact or an explicitly supplied consumer checkout. It must not depend on whichever sibling checkout happens to exist. Do not create a separately published tooling package unless cross-repository reuse demonstrates that need.

Gate: consumer mechanics can change and be validated without modifying engine tooling; the explicitly selected compatibility run remains reproducible. Consumer selection, revision and configuration are invocation inputs, never hardcoded game names, adapters or bundled snapshots. Prove selection is generic with contract stubs in addition to the real consumer run.

## 5. Consolidate browser sessions

Build one internal session interface over the existing transport and cleanup primitives. It owns browser discovery, launch, profile/port allocation, readiness, connection lifecycle, diagnostic capture, and cleanup of resources it creates. Externally supplied servers remain explicitly caller-owned.

Keep scenario assertions, navigation sequences, warmup, sampling windows, budgets, and measurement policy outside this module. Support existing page and browser CDP sessions, event subscriptions, per-operation deadlines, heap snapshots, and tracing.

Before replacing the older transport, verify large replies at and above the documented failure size, fragmented messages, real heap sampling, and snapshot event streams. Existing mocked transport tests cannot establish wire-level compatibility. Extract the existing large-frame socket behind shared transport; add no WebSocket dependency in this epic. Verify parity before removing its old implementation.

Preserve failure semantics: command timeout does not imply cancellation or replay; diagnostics must not erase the original failure; incomplete cleanup fails acceptance. Exercise partial-startup failures as well as successful runs.

Gate: migrated runners retain profiler capabilities and pass assertion-failure, diagnostic-failure, cleanup-failure, and owned-process cleanup checks on Windows and Linux where supported.

## 6. Migrate benchmarks and comparison modes

Install an engine-owned workload against the freshly prepared tarball. Generate deterministic asset churn independently of Town/Dungeon schemas. Reuse preparation and browser lifecycle infrastructure while retaining workload-specific measurement logic.

Extract the existing content comparator and retain the aggregate comparator attention scan (compatibilityWarnings, attentionPercent, regression/improvement summaries) as advisory reporting. It cannot override comparability gates. Keep two explicit controlled-comparison modes:

- **Repeatability:** preserve strict artifact, workload, harness, policy, and environment equality.
- **Candidate comparison:** allow engine tarball, installed engine files, and engine-derived bundle outputs to differ. Hold authored workload, generated assets, non-engine dependencies, toolchain, harness, policy, and environment constant. Record both output identities and explain permitted differences.

Separate immutable workload inputs from build outputs in manifests. Current generated fixture directory hashes include bundles and cannot serve directly as a candidate workload signature.

Separate measurement validity from budget success. A complete valid candidate run with successful cleanup can be compared even when it exceeds budgets; report the budget failure. Crashes, incomplete samples, artifact mismatches, or failed cleanup invalidate comparison.

Treat the recorded environment as a named baseline. Require explicit selection for other baselines, verify actual environment against the selected profile, and keep exploratory runs distinct. Record enough hardware, browser, Node, flags, viewport, visibility, adapter, OS, and method information to assess comparability. Baseline names alone do not prove equivalent conditions.

Gate: strict mode rejects changed artifacts; candidate mode accepts engine-only changes, rejects workload/harness/environment drift, and reports valid over-budget regressions. Establish new performance baselines for the new workload rather than carrying over Town/Dungeon thresholds without evidence.

## 7. Finish commands, CI, and documentation

Introduce tooling typechecking when shared modules are first added; complete coverage of Node runners and browser-injected code with appropriate configurations. Use TypeScript or checked JavaScript without suppressions that defeat the check.

Expose separate package, showcase, browser-fixture, tooling-check, installed-verification, compatibility, and benchmark targets, plus an aggregate engine verification command. Document prerequisites and expensive benchmark modes. Preserve benchmark execution as an explicit entry point rather than requiring full performance runs for every verification.

Replace PowerShell benchmark orchestration with Node while preserving options, artifact handling, failure propagation, and cleanup behavior. Cross-platform orchestration does not make software-GPU and physical-GPU results interchangeable.

T1b deliberately measures five successful verification runs at the frozen pre-migration revision with deployment disabled; this may proceed alongside T2 on that frozen ref. Do not assume comparable history exists. Require five matched final runs with median wall-clock growth at most the proposed 20%, recording absolute per-stage durations and artifact bytes. Match runner/toolchain/cache conditions and map equivalent coverage across the intentionally changed workflows; remeasure the frozen baseline if environment drift prevents matching. Missing baseline measurements block T1b and final cost acceptance.

Update CI commands and artifact-upload paths with each migration stage. Preserve failure-injection checks and root/nested validation. Keep the existing showcase verification/deployment relationship intact.

Update owning documentation for commands, manifests, coverage ownership, baseline selection, and evidence limits.

## Completion criteria

- A clean NGNE checkout validates its freshly built installed package and runs engine workloads with all external consumer checkouts, artifacts and game snapshots absent, without fetching them.
- Default engine commands and CI have no external consumer dependency. A separate explicitly selected compatibility run proves the generic contract; failure cannot be silently skipped.
- Commands run twice without manual cleanup and retain separate outputs.
- Package resolution cannot fall back to repository source.
- Stale, altered, or incomplete artifacts fail validation.
- Engine lifecycle and package coverage survive the migration; consumer acceptance has an external owner and explicit command. No active Town/Dungeon-specific runner, assertions, schemas, configuration or archived game fixture remains embedded in NGNE; labeled historical evidence is preserved.
- Game-mechanics changes require no engine-tooling edits.
- Shared browser sessions preserve large profiler replies, diagnostics, and cleanup failure semantics.
- Strict and candidate comparisons enforce their respective identity rules and report validity separately from budgets.
- Windows and Linux entry points are exercised with environments and limitations recorded.
- Historical evidence remains intact and is not presented as validation of the new workload.

## Execution order

T1a adoption, coverage map, checker and test discovery → extract existing lifecycle/identity and add package-only preparation → engine-owned installed fixture → browser-session consolidation → consumer scenario separation → benchmark/comparator extraction and extensions → delivery integration → superseded-file cleanup → final acceptance. T1b consumer conformance, legacy fixtures and frozen-revision CI measurements proceed alongside T2; they gate consumer integration, legacy comparison and final cost acceptance respectively. Browser work does not wait for consumer authorization.

Add tooling checks as modules are introduced and update CI throughout. Keep the compatibility suite active until the coverage and migration gates pass. Implementation begins only after review of this plan.
