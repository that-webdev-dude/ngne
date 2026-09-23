> Adopted for implementation under plans/tooling/. Original review-pack location statements below are historical; local links target this adopted pack. See [planning records](README.md) for current adoption status.

# Proposed Jira epic and ticket sequence

Status: local proposal for review. No Jira issues have been created.
Date: 2026-09-22

## Epic: Make engine tooling independent, repeatable, and evidence-driven

Extract and generalize the existing content runner, both comparison paths, and shared transport/cleanup. Implement the [decoupling plan](migration-plan.md) using the [layout and evidence contracts](layout-and-evidence-contracts.md). Rework workflows into the new layout incrementally; remove superseded implementations after replacement evidence passes. Preserve public engine contracts and historical evidence.

Completion: a clean engine checkout validates its current package and executes engine workloads with all external consumers absent and without fetching them; default commands and CI have no consumer dependency; compatibility uses a generic explicitly supplied consumer contract and is required to pass when selected; commands run twice without manual cleanup; artifacts identify what actually ran; compatibility is explicit; assertions, profiler capabilities, and cleanup safeguards survive; portable evidence and strict/candidate comparison work; superseded active tooling is removed.

These review documents live outside the repository in ngne-backups; links resolve within that review pack. T1a adopts the complete pack under plans/tooling/ with local links, never as ticket history under docs/. T1 is split into T1a and T1b; T2-T10 retain their existing labels. These eleven proposal tickets are not Jira keys; their execution order is stated below. Every ticket includes its own tests, owning documentation, command updates, and CI integration. External publication and consumer-repository changes require their applicable authorization. Implementation does not include deployment.

## Consumer independence and epic sequencing

Complete this tooling epic through T10 before starting the next planned epics. NGNE owns engine fixtures, benchmarks, execution and evidence infrastructure. External consumers own their game scenarios, assertions, schemas and configuration.

Compatibility is an opt-in invocation against an explicitly supplied consumer checkout or pinned artifact. Any conforming consumer must run without NGNE tooling edits. No game-specific adapter, default consumer, sibling discovery or embedded game snapshot remains in the final implementation. Unselected compatibility makes no compatibility claim; selected compatibility cannot skip missing prerequisites, failed checks, invalid evidence or cleanup failure.

Town/Dungeon supplies temporary migration coverage and one real integration proof, not a permanent tooling dependency. T4 removes it from default engine commands and CI after replacement coverage passes; T10 separately proves engine independence and explicit consumer integration.

## T1a. Adopt the plan and establish mechanically checked coverage ownership

Dependencies: none. Plan coverage: sections 1 and 7.

Scope:

- Adopt the complete linked review pack under plans/tooling/. Deliver surface-inventory.json, coverage-map.json plus rendered table, and retirement-map.json. Add tooling/commands/check-migration.ts; do not create empty scaffolding.
- Freeze the full pre-migration revision and workflow hash for T1b baseline runs before T2 starts.
- Inventory assertions, workloads, commands, flags, configs, evidence readers, and CI steps.
- Map engine versus consumer ownership and create the retirement map with replacement gates. Inventory all consumer-specific code, schemas, snapshots, defaults and CI dependencies; assign their removal from NGNE's active/default paths before final acceptance.
- Define command compatibility, schema validation/versioning, environment requirements, and evidence export policy.
- Update RULES.md and npm test discovery in this ticket, alongside the first checker tests: tsx --test tests/_.test.ts tooling/tests/_.test.ts. Keep test entry files flat; add initial Node tooling typechecking and ensure CI runs both directories.

Acceptance:

- check-migration.ts verifies exact equality of enumerated and mapped surface IDs, unique rows, explicit exclusions and valid ownership/destinations. Deliberately adding an unmapped file/command/CI surface fails the check. Assertion/workload subtables have reviewed stable IDs; unknown replacement proof blocks deletion rather than T1a completion.
- No deletion is justified by assertion counts alone.
- Required versus optional checks and migration compatibility execution are explicit.
- Checker regression tests and existing engine tests are discovered by npm test; initial tooling typechecking passes. Advisory comparison behavior and the frozen baseline revision are recorded.

## T1b. Establish consumer conformance, legacy fixtures, and a measured CI baseline

Dependencies: T1a. Runs alongside T2; no consumer-repository implementation is required. Plan coverage: sections 1, 4, 6 and 7.

Scope:

- Deliver consumer-command-contract.md, schema examples, executable stub and tooling/evidence/consumer-contract-v1.ts with tooling/tests/fixtures/consumer-contract-v1/. Coordinate shared schema definitions with T2; do not implement a second evidence schema.
- Freeze the v1 tarball/hash/output command, exit semantics and response validation. Record owner agreement or unresolved status.
- Deliver legacy-formats.md and named valid/invalid fixtures under tooling/tests/fixtures/legacy/ for the two bounded reader families; zero curated-document conversion adapters.
- Deliver ci-cost-baseline.json from five deliberate successful verification runs at T1a's frozen pre-migration revision, with deployment disabled. Runs may proceed alongside T2 on the frozen ref. Record absolute stage/wall durations, artifact bytes, run IDs, environment and cache conditions; do not assume historical runs exist.

Acceptance:

- Conformance tests cover valid response, hash mismatch, unsupported version, reused output, incomplete result, cross-document run-ID mismatch, artifact tampering and escaping paths.
- The versioned validator and fixture set are identified by revision/hash; T4 must use the validator on every invocation, including failed responses.
- Supported legacy variants and unsupported-format rejection cases are explicitly named.
- Five baseline measurements exist; unavailable hosted execution leaves this ticket incomplete, not waived. The proposed 20% final median budget has a measured denominator.
- Consumer agreement may remain recorded as unresolved here; T4 completion requires agreement and real consumer conformance.

## T2. Extract content-run lifecycle and identities; add isolated package preparation

Dependencies: T1a; T1b proceeds alongside this ticket. Plan coverage: section 2 and early section 7.

Scope:

- Add package-only build and scoped clean emission.
- Extract existing lifecycle, identities and cleanup-result handling from benchmarks/content/run.mjs and fixtures.mjs; reuse tests/tooling/cleanup.mjs and run-results.mjs integrity patterns. Add only missing shared behavior: format/documentType/schemaVersion/runId, atomic partial/final records, independent outcomes, runtime checks and typechecking.
- Pack using npm pack --json; record real filename/hash; install in isolation with a reproducible dependency policy.
- Implement identity verification and explicit prepared-manifest handoff.
- Produce report/result records including early failures and cleanup outcomes.

Acceptance:

- Two runs create independent outputs; existing explicit destinations are rejected.
- Stale emitted files cannot enter a fresh package.
- Changed package/installation/build identities and incomplete preparation are rejected.
- Extraction regression fixtures preserve existing identity, samples, policy and cleanup evidence. Failures retain logs and partial evidence; final status follows cleanup. Independent outcomes are an explicit behavior change, not claimed existing equivalence.
- New shared modules are covered by meaningful regression tests and typechecking using the harness and npm discovery introduced in T1a; extend those configurations as modules arrive.

## T3. Introduce engine-owned installed verification

Dependencies: T2. Plan coverage: section 3.

Scope:

- Build a readable minimal fixture resolving only the installed public package.
- Exercise declarations, imports, assets, root/nested bases, preparation, cancellation, failure recovery, disposal, ownership/retention, rendering and audio lifecycle.
- Place the workflow under tooling; use existing transport/cleanup temporarily where necessary, without cloning another runner.
- Keep existing Town/Dungeon compatibility active during replacement validation.

Acceptance:

- Installed verification runs with all external consumer checkouts/artifacts/game snapshots absent, without retrieving them.
- Source alias/fallback resolution is rejected.
- Coverage map links migrated engine assertions to passing replacement evidence.
- Physical-device/software-WebGPU/manual evidence is reported distinctly.
- Standalone installed verification prepares prerequisites and runs twice.

## T4. Deliver generic consumer integration and remove embedded consumer dependencies

Dependencies: T3 and T1b consumer-contract agreement/conformance artifact. Default execution follows T5, but consumer work does not block T5. Plan coverage: section 4 and consumer portion of section 6.

Scope:

- Move game controls, collision rules, saves, sessions, progression, checkpoint acceptance, and game transition measurements into the consumer repository.
- Implement the exact verify:engine contract fixed in T1b: contract version, tarball path, SHA-256, fresh output directory and run ID; emit ngne-tooling v1 evidence. Do not redefine the cross-repository interface here.
- Add one consumer-neutral compatibility invocation in NGNE, taking consumer location and pinned identity as explicit inputs. Use it for temporary migration CI; do not add a Town/Dungeon-specific runner. Run the T1b versioned consumer validator on every returned response; record its revision/hash and fixture-set identity.
- Select and document pinned artifact versus supplied checkout invocation, without implicit sibling discovery or premature shared package publication. Consumer configuration belongs outside NGNE and is supplied explicitly; adding a conforming consumer requires no engine-tooling edits.

Acceptance:

- Consumer-owned replacements pass before old checks are removed from the engine default suite. Then remove all external consumer stages/defaults from ordinary and aggregate engine verification and default CI; this removal is required for T4 completion.
- Game-mechanics changes need no engine-tooling edits.
- Compatibility results identify engine and consumer versions and retain existing coverage. Missing/invalid schema fields, unsupported versions, mismatched identities, corrupt artifacts or escaping paths fail the NGNE gate even with consumer exit zero; regression tests prove drift is detected after initial adoption.
- Engine verification works with all external consumer checkouts, artifacts and snapshots absent and does not fetch them.
- Synthetic conformance stubs prove consumer selection is generic; an explicitly supplied real consumer proves integration. Missing selection inputs, consumer failure, invalid evidence and cleanup failure fail selected compatibility runs. No active game-specific adapter, assertions, schemas, configuration or fixture archive remains embedded in NGNE.

## T5. Consolidate browser execution and preserve profiler capabilities

Dependencies: T3; execute before T4 in the default sequence. No consumer authorization dependency. Plan coverage: section 5.

Scope:

- Implement one browser session over shared transport/process/server ownership.
- Migrate verification and existing browser benchmark execution to it without changing workload semantics.
- Preserve page/browser connections, event streams, deadlines, tracing, snapshots, diagnostics, and bounded cleanup.
- Extract/adapt the existing large-frame RFC 6455 socket from browser-baseline.ts behind shared transport. Add no WebSocket dependency and no engine runtime dependency; a later replacement requires a separate explicit decision.

Acceptance:

- Test real replies at and above the documented 4.26 MB failure size, fragmentation, heap sampling, and heap snapshots.
- Partial startup, assertion failure, screenshot/diagnostic failure, and cleanup failure preserve correct outcomes.
- No command replay on timeout; original errors remain visible.
- Owned process cleanup is verified on Windows and Linux where supported.
- Old transport is retired only after capability parity is demonstrated.

## T6. Migrate engine benchmarks and replace PowerShell orchestration

Dependencies: T4 and T5. Plan coverage: sections 6 and 7.

Scope:

- Move CPU/rendering/content workloads into tooling/suites/benchmarks.
- Make package-boundary benchmark workloads install the freshly prepared package; explicitly identify any internal microbenchmarks separately.
- Generate deterministic engine-owned content churn independent of game schemas.
- Replace run-all/compact PowerShell orchestration with Node, preserving relevant flags, diagnostics, failure propagation, and artifact retention behavior.
- Add named environment profiles, observed-environment validation, and distinct exploratory mode.

Acceptance:

- Benchmarks run without a sibling consumer and identify the measured engine artifact or explicitly declared internal source target.
- Workload parameters, seeds, instrumentation, units, raw samples, and identities are recorded. Above-budget but otherwise correct execution completes prescribed sampling; merely relaxing the old comparator gate is insufficient because the old runner can abort collection on budget failure.
- Windows/Linux entry points work; performance claims remain scoped to their actual environments.
- New workloads receive new measured baselines; historical budgets are not silently transferred.
- Existing workload/flag coverage is mapped to replacements or explicitly justified retirement.

## T7. Extract both comparators; add explicit candidate comparison

Dependencies: T6 and T1b legacy fixtures. Plan coverage: section 6.

Scope:

- Separate workload-input identities from engine-derived build identities.
- Extract strict comparison from benchmarks/content/compare.mjs. Preserve the advisory scan from benchmarks/compare-runs.mjs: compatibilityWarnings, problems, attentionPercent default 10, metric directions, regressions/improvements and scanResult precedence. Keep scan separate from acceptance; implement new-format repeatability/candidate gates without orphaning the advisory CLI.
- Separate measurement validity, correctness, cleanup, and budget status.
- Produce machine-readable comparison and a report explaining mismatches before metrics.

Acceptance:

- Strict mode rejects changed artifacts.
- Candidate mode accepts engine-only changes, including legitimate derived bundles, and rejects changed workload, harness, policy, dependencies, or required environment.
- Valid correct over-budget runs remain comparable and report regression.
- Crashes, incomplete samples, correctness failures, and cleanup failures prevent accepted performance conclusions.
- Two bounded legacy reader families retain their existing strict/advisory semantics through extraction: content-legacy and benchmark-legacy (per-stage and consolidated/compact variants). Curated evidence needs no adapter. New format/documentType discriminators prevent filename collisions. Old/new mixed comparisons require remeasurement, not invented identity. Tests preserve the attention scan and prove incompatible deltas are labeled unvalidated.

## T8. Complete portable evidence delivery and aggregate commands

Dependencies: T7 and T1b measured baseline. Plan coverage: sections 2 and 7; evidence-contract completion.

Scope:

- Complete default/full export, payload inventories, hash verification, omission declarations, and portable relative links.
- Complete aggregate verification with exact manifest reuse and stage outcomes.
- Finish separate package/showcase/browser-fixture/tooling targets and consistent CI uploads. Start with one Ubuntu verification job, one preparation, manifest reuse and one evidence-tree upload; avoid duplicate ZIP uploads. Full exports/benchmarks stay explicit. Implement the measured CI cost decision from T1b; split jobs only on evidence with a preserved aggregate deployment gate.
- Preserve the existing showcase verification/deployment relationship using engine-owned verification. Default CI and its aggregate deployment gate require no external consumer; separately selected compatibility remains a required stage only within the invocation/job that selects it.

Acceptance:

- Extracted exports can be inspected and compared without the original checkout.
- No node_modules, browser profiles, caches, or accidental absolute-path dependencies are delivered.
- Missing optional diagnostics are explicit; missing required evidence prevents success.
- A required skipped stage cannot yield successful aggregate verification.
- Failure artifacts are uploaded in CI; expensive benchmarks remain explicit.

## T9. Remove superseded tooling and consolidate historical evidence

Dependencies: T8 and all relevant replacement gates from T1a/T1b and T2-T7. Plan coverage: final migration cleanup.

Scope:

- Complete retirement-map review and remove superseded runners, duplicate transport/cleanup, old PowerShell scripts, obsolete configs, dead helpers, archived fixture copies no longer used, and temporary aliases that have fulfilled migration needs.
- Remove benchmarks/ and tests/tooling/ only when all live responsibilities and retained evidence have moved.
- Remove only game-specific/migrated helpers from tests/; preserve engine unit/contract tests and their support.
- Consolidate retained benchmark evidence under docs/evidence, preserving bytes/hashes and repairing references.
- Update package scripts, Vite/TypeScript configuration, test discovery, formatting scope, ignores, docs, and CI paths.

Acceptance:

- Every removed check has a passing replacement owner or an explicitly reviewed retirement reason.
- No live import, command, config, or CI step points to deleted paths.
- No external consumer default or automatic retrieval, embedded game snapshot, game-specific runner/assertions/schemas/configuration, sibling discovery, hardcoded package version, stale active output path, or duplicate runner remains. Preserve only inactive historical evidence and the generic opt-in compatibility path.
- Historical references remain labeled and usable; evidence hashes are preserved.
- Do not recursively purge user outputs, unrelated files, or historical .test-output data.
- Relevant checks pass after deletion, not merely before it. Keep extracted bounded legacy readers and advisory scan; only superseded original implementations are retired. check-migration.ts reconciles frozen old IDs, replacement proof and remaining references.

## T10. Prove final clean-checkout and cross-platform acceptance

Dependencies: T9. Plan coverage: all completion criteria.

Scope:

- Exercise clean checkout with documented dependencies/browser prerequisites and all external consumer checkouts, artifacts and game snapshots absent. Prove default commands and CI neither access nor fetch a consumer.
- Run verification and selected benchmark commands twice without manual cleanup.
- Recheck artifact tampering, stale emission, incomplete preparation, assertion/diagnostic/cleanup failure, and export integrity.
- Record local Windows and hosted Linux evidence, supported browser/device classes, and limitations.
- Complete coverage/retirement maps and final command/documentation audit.

Acceptance:

- Epic completion criteria are demonstrated by fresh evidence from the final layout.
- Shared profiler capability and cleanup checks still pass after all migrations.
- Reports identify tested package/workload/harness/environment and separate manual, physical-GPU, and software-GPU evidence.
- A separate compatibility run against an explicitly supplied real consumer passes the generic contract. It is epic acceptance evidence, not a default engine dependency. Consumer mechanics and configuration remain external; synthetic conformance tests show another conforming consumer can be selected without NGNE changes.
- No unresolved required coverage or cleanup gate is hidden by passing aggregate output. Record five matched final CI runs against the T1b frozen-revision timing baseline: proposed median wall-clock growth at most 20%; report absolute durations, artifact bytes, migration overhead and any explicit budget revision. Missing timing evidence is not a pass. Final timing runs cover default engine verification with all external consumers absent; report explicit compatibility costs separately and map relocated consumer checks so reduced default scope is not claimed as an engine speedup.

## Default sequence

T1a → T2 → T3 → T5 → T4 → T6 → T7 → T8 → T9 → T10, with T1b alongside T2. T1b supplies T4's consumer contract, T7's legacy fixtures, and T8/T10's measured CI baseline. T2-T10 labels remain stable for review references.

T5 proceeds after T3 without waiting for consumer authorization; T4 may proceed alongside it when authorized. Engine-only T6 work can start after T5, while retirement of consumer-dependent measurements waits for T4. Full T6 acceptance retains both dependencies. Keep tests, documentation, and CI current in each ticket; T8 completes delivery integration rather than postponing it. Delete superseded files during individual migrations when safe; T9 closes the remaining retirement map rather than retaining duplicate implementations unnecessarily.
