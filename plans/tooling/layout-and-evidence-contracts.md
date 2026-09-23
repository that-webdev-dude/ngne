> Adopted for implementation under plans/tooling/. Original review-pack location statements below are historical; local links target this adopted pack. See [planning records](README.md) for current adoption status.

# Tooling layout and evidence contracts

Status: proposed design for review; no implementation authorized by this document.
Date: 2026-09-22

This document formalizes the target layout and evidence contracts for the [engine verification decoupling plan](migration-plan.md). That plan defines the migration objectives and regression gates; this document specifies where responsibilities live and what each run delivers. The [ticket sequence](jira-ticket-sequence.md) proposes implementation order. All three documents currently live in ngne-backups, outside the repository, as requested; their relative links resolve there. These are review proposals, not repository-authoritative documentation. At adoption, T1a places the complete planning set under plans/tooling/ with repaired links. Current operational documentation belongs in tooling/README.md and must not contain ticket history. Introduce directories when their first implementation needs them, not as an empty scaffold.

## Objectives

- Validate the current installed engine package and run engine benchmarks with all external consumers absent; default commands and CI must not fetch or require consumer checkouts, artifacts or embedded game snapshots.
- Keep engine verification, performance measurement, and consumer acceptance separately owned.
- Consolidate execution infrastructure without creating a generic plugin framework.
- Make commands repeatable and results attributable, portable, and independently inspectable.
- Retire superseded implementations after replacement coverage passes; preserve historical evidence.

## Source layout

```text
tooling/
  README.md                         Commands, prerequisites, evidence guide
  commands/
    verify.ts                       Verification workflow selection/composition
    benchmark.ts                    Benchmark selection/composition
    compare.ts                      Comparison CLI
    export.ts                       Evidence export CLI
    check-migration.ts              Repository migration lint (T1a)
  core/
    run.ts                          Unique run, stages, finalization
    package.ts                      Clean emission, build, pack
    fixture.ts                      Isolated install and fixture builds
    process.ts                      Owned processes and bounded cleanup
    server.ts                       Serve prepared fixture builds
    browser/
      session.ts                    Browser launch, readiness, diagnostics, shutdown
      transport.ts                  CDP requests, events, connection lifecycle
  evidence/
    schema.ts                       Versioned types and runtime validation
    consumer-contract-v1.ts         Consumer response validator used on every invocation
    identity.ts                     File inventories and content hashes
    report.ts                       Reports derived from recorded evidence
    compare.ts                      Comparability and metric differences
    export.ts                       Portable bundle generation and verification
  suites/
    verification/
      package.ts                    Imports, declarations, package contents
      browser/                      Node orchestration and engine assertions
    benchmarks/
      cpu/
      rendering/
      content/
    compatibility/
      consumer.ts                   Generic explicitly supplied consumer invocation
  fixtures/
    installed-engine/               Minimal public-package application and assets
    rendering/                      Dedicated rendering workload application
  profiles/
    environments/                   Named expected environment profiles
  tests/                            Flat *.test.ts tooling regression harness
    fixtures/consumer-contract-v1/   Versioned valid/invalid conformance evidence
    fixtures/legacy/                Named supported legacy variants
  tsconfig.node.json
  tsconfig.browser.json
```

Commands parse inputs and compose concrete operations. Suites own assertions, workload sequencing, warmup, sampling, budgets, and suite-specific instrumentation. Fixture applications own their browser entry points and assets. Workload generators and policy files stay beside their suite unless shared by demonstrated callers.

Core infrastructure owns resource lifecycle. Evidence code owns records, validation, reports, and comparisons. Neither imports suite-specific code. Fixtures import the installed public engine and their own application code, never Node runner internals. Use separate Node/browser typechecking; typecheck any browser-injected code rather than leaving substantive logic in unchecked strings.

Keep engine unit and contract tests in `tests/`, including engine-only test helpers. T1a updates RULES.md and the npm test script together when adding checker regression tests: `tsx --test tests/*.test.ts tooling/tests/*.test.ts`. Keep tooling test entry files flat under `tooling/tests/`; nested fixture data is not test discovery. T1a also adds Node tooling typechecking for its first executable modules and verifies both test directories are exercised in local and CI runs. T2 extends this harness rather than introducing another one. Keep product emission and package export paths under `dist/`; isolate tooling fixture outputs in `out/`. Keep curated historical records under `docs/evidence/`. Consumer mechanics and transition measurements belong in the consumer repository.

The browser session supports page/browser CDP sessions, event subscriptions, configurable deadlines, profiling and tracing. It guarantees bounded cleanup of owned resources, including partial startup. Externally supplied servers remain caller-owned. Timeout never implies command cancellation or replay. Diagnostic failures must not hide scenario failures. Preserve real large-message and heap-profiler capability before replacing the older transport.

## Command contract

Provide explicit package, showcase, browser-fixture, tooling-check, installed-verification, compatibility, benchmark, comparison, and export entry points. npm scripts can select workflows in the thin command modules; a separate file per script is unnecessary.

Standalone commands prepare prerequisites. Aggregate verification prepares once and passes exact verified identities to its stages. Full performance benchmarks remain explicit rather than part of every verification run. Compatibility is a separate opt-in workflow requiring a selected pinned consumer artifact or explicit checkout, never an implicit sibling path, default game, or bundled consumer snapshot. Default and aggregate engine verification and default engine CI contain no external consumer stage. When compatibility is explicitly selected, its prerequisites, checks, evidence validation and cleanup are required; missing or failing inputs cannot be silently skipped. Reports distinguish unselected compatibility from verified compatibility.

Preserve existing command aliases during migration only where needed. Track their retirement. A skipped or unavailable required stage must not produce successful aggregate verification.

## Consumer independence

The compatibility runner knows the versioned command and evidence contract, not any game's mechanics or directory layout. Consumer identity, location, revision and configuration are explicit invocation inputs. Do not retain game-specific adapters, assertions, schemas, fixture archives or CI defaults in NGNE. Minimal engine-only fixtures and synthetic contract conformance fixtures remain engine-owned; historical game evidence may remain clearly labeled and inactive.

Any conforming consumer can be supplied without editing NGNE tooling. The consumer owns its acceptance command, installation, scenarios and configuration. Prove generic selection with synthetic conformance stubs and one real external consumer, initially Town/Dungeon. The real run is a migration/epic acceptance proof, not a permanent dependency of engine verification. Optional selection does not weaken a selected run's acceptance criteria.

Complete tooling through final acceptance before subsequent epics. Temporary migration compatibility has an explicit retirement gate: passing replacement engine checks and consumer-owned checks, followed by removal from default engine commands and CI. Final verification and benchmarks run twice with every external consumer absent and without automatic retrieval.

## Generated output layout

```text
out/
  runs/
    <timestamp>-<suite>-<unique-id>/
      work/
        installation/
        builds/
        browser-profile/
      evidence/
        manifest.json
        result.json
        report.md
        artifacts.json
        package/                    Exact tested tarball
        builds/                     Retained tested builds when applicable
        stages/
          <stage-id>/
            observations.json
            measurements.json
            logs/
            diagnostics/
  comparisons/
    <comparison-id>/
      comparison.json
      report.md
  exports/
    <run-id>.zip
```

Create applicable directories only. One top-level invocation owns one run directory; aggregate commands use named stages. Existing explicitly supplied output destinations are rejected. No implicit latest-success lookup is allowed. `out/` is ignored by Git. Old `.test-output/` data is not automatically deleted.

Working directories are disposable execution state. Evidence contains portable records and retained artifacts. Keep prepared inputs unchanged and use disposable copies for intentional mutation tests. Record the original identities and the fault-injection scenario.

## Evidence documents

| Document          | Authoritative responsibility                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| manifest.json     | Run selection, package/workload/harness identities, parameters, observed environment, stage identities |
| result.json       | Stage/run execution, correctness, budgets, failures, cleanup, evidence completeness                    |
| artifacts.json    | Relative path, hash, byte size, role, stage, and retention classification of payload files             |
| observations.json | Individual assertion identity, outcome, and relevant observations                                      |
| measurements.json | Raw samples, units, sampling method, counts, and derived metrics                                       |
| report.md         | Human-readable projection of authoritative records                                                     |
| comparison.json   | Input run identities, comparison mode, compatibility decision, mismatches, and metric differences      |

All machine-readable documents have schema versions and run IDs, or comparison IDs plus referenced run IDs. Validate loaded records at runtime; reject unsupported schemas clearly. Legacy support is limited to the two reader families named below; there is no general historical-document conversion project.

Use run-relative POSIX-style paths in evidence. Resolve paths within the selected evidence root and reject escaping references. Avoid dependence on absolute workspace paths. The artifact inventory excludes itself to avoid circular hashing. Generate final records and report before hashing their payloads. Exports verify inventory hashes and contain no broken references to omitted local files.

During execution, write initial manifest/result records and persist stage progress atomically. After scenario execution, attempt independent cleanup and collect failures. Finalize outcome and evidence only afterward. If final evidence writing fails, exit nonzero and leave the run incomplete; never claim success from an earlier partial result. Detect interrupted runs by nonterminal state; do not reinterpret them as passed.

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

## Comparison contract

- Repeatability mode requires matching engine, workload, harness, policy, build, and relevant environment identities.
- Candidate mode permits engine artifacts and engine-derived build outputs to differ. Workload, generated assets, non-engine dependencies/toolchain, harness, method, policy, and relevant environment remain fixed.
- Exclude incidental timestamps, random run paths, and process IDs from comparability signatures.
- Report each incompatible field and the evidence supporting the decision. Changed build filenames may be legitimate engine-derived differences.
- A complete correct run above budget remains comparable and reports its regression. Do not require budget success as a comparison prerequisite.
- Harness changes require remeasurement of both engine versions under the new harness. Changed workload requires a new baseline; preserve old evidence as historical.

## Export and retention contract

Default export contains manifests, results, artifact inventory, report, package, observations, raw measurements, logs, and required failure diagnostics. Optional full export includes retained fixture builds and large traces/heap snapshots. Record every omission and its effect on supported analysis. Export inventories describe included payloads; original inventories may be retained as provenance without pretending omitted files are present.

Never export node_modules, browser profiles, caches, or disposable installations. Validate that extracted reports and comparisons can be inspected without the original workspace. Inspection/comparison portability does not promise offline execution reproducibility; reproduction may need dependencies and a matching environment.

Retain failed evidence. Terminate owned processes even when retaining failed workspaces. Workspace pruning and evidence deletion are explicit operations with checked target paths. Do not remove old outputs simply because a new run starts.

## Existing implementations and extraction decisions

The migration starts from working implementations, not a replacement framework:

| Existing implementation                     | Extract or preserve                                                                                                      | Actual new behavior                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| benchmarks/content/run.mjs and fixtures.mjs | Run lifecycle, file identities, samples, environment capture, policy and cleanup evidence                                | Reuse across workloads; namespaced schemas/run IDs; preparation handoff; independent outcomes |
| benchmarks/content/compare.mjs              | Strict signature and cleanup acceptance gate                                                                             | New-format candidate mode and explicit validity/budget separation                             |
| benchmarks/compare-runs.mjs                 | Compatibility warnings, metric definitions/directions, attentionPercent, regression/improvement scan and Markdown report | Integrate advisory analysis with explicit comparability decisions                             |
| benchmarks/run-results.mjs                  | Legacy loading, consolidated analysis validation, compact retention and integrity checks                                 | New evidence format integration without weakening old checks                                  |
| benchmarks/content/policy.json              | Workload parameters, seed, warmup, retention and budgets                                                                 | Workload-owned versioned policy identity                                                      |
| benchmarks/content/environment.json         | Recorded browser/GPU/OS/viewport/DPR environment                                                                         | Named expected profile plus independently recorded observations                               |
| tests/tooling/devtools.mjs and cleanup.mjs  | Transport lifecycle, request correlation, cleanup aggregation/process verification                                       | One session interface and shared ownership across callers                                     |
| benchmarks/browser/browser-baseline.ts      | Large-frame socket, profiling, tracing and measurement behavior                                                          | Adapt existing socket behind shared transport; remove duplicate lifecycle after parity        |

New schemas generalize what these already record. Budget outcome separation is a deliberate change: the current content runner asserts budget success and can stop collecting further runs after failure. The new runner must finish the prescribed samples when correctness and execution remain valid, record the budget failure, and still perform cleanup. Merely relaxing the comparator's passed-status predicate would admit incomplete evidence.

## Comparison decisions and legacy scope

Retain both existing comparison semantics. The strict gate establishes whether a controlled comparison is justified. The attention scan is a reporting layer: preserve compatibilityWarnings, problems, attentionPercent (default 10), metric direction, notable regressions/improvements, and scanResult precedence. An attention threshold is not a budget and not statistical significance.

New-format comparison defaults to repeatability. Explicit candidate mode allows the declared engine-derived differences. In both modes, reports may show diagnostic deltas for incompatible runs, but label them unvalidated and never present them as accepted improvements/regressions. Provide explicit scan mode for advisory triage without a controlled-comparison claim. Preserve the existing bench:compare alias as advisory scan during migration, document any later CLI change, and retain its established report vocabulary.

Bound compatibility work to two read-only legacy reader families:

1. content-legacy: the exact existing content-run family (manifest.json, fixtures.json, runs.json, result.json, with policy/cleanup/tooling fields where recorded). Preserve its original strict comparability and acceptance gate; missing old identity fields are unknown, not fabricated. Historical runs are not upgraded into candidate-mode evidence.
2. benchmark-legacy: the aggregate run family already read by run-results.mjs: schema-1 per-stage results and schema-2/consolidated analysis including compact retention. Preserve existing validation and advisory scan semantics; explicit legacy selection avoids interpreting arbitrary JSON by filename.

This is two reader families, not two generic converters. Add named valid/invalid fixtures for each supported variant during T1b. Reject any unlisted legacy variant with an actionable unsupported-format message. No automatic old/new mixed comparison is in scope; remeasure both candidates under the new harness.

Curated documents remain readable as original JSON/Markdown/downloadable archives and receive zero new-format adapters:

- docs/evidence/installed-content.json and its accompanying Markdown/hosted archive.
- docs/evidence/runner-cleanup.json and its accompanying Markdown.
- benchmarks/evidence/content.json, content.md and content-raw.json.gz; relocate only with byte/hash and link preservation. The summary wrapper is historical evidence, not a new run manifest.

Use format: "ngne-tooling", schemaVersion: 1, and an explicit documentType on every new machine-readable document, plus runId or comparisonId. Reused filenames never select a format. Missing format tags cannot be interpreted as new-format data. A supported legacy reader is chosen explicitly and never invents a new historical run ID or schema declaration.

## Cross-repository command contract v1

Freeze this in T1b before either consumer-contract implementation is integrated. Proposed consumer npm entry point:

```text
npm run verify:engine -- --contract-version 1 --engine-tarball <absolute-path> --engine-sha256 <sha256> --output <new-absolute-run-directory> --run-id <id>
```

The caller explicitly supplies the consumer checkout/artifact and revision to the generic NGNE compatibility runner, which invokes the command from that checkout, and supplies an immutable tarball plus expected hash. It does not pass an engine-internal prepared-manifest path. The caller owns consumer selection and launching/terminating the command; the consumer owns isolated installation, acceptance, child processes, and cleanup. Dependency/browser prerequisites are documented by the consumer command. No sibling discovery or shared-workspace installation is permitted.

The consumer verifies tarball bytes before installation, records installed engine identities, and writes output/evidence/{manifest.json,result.json,artifacts.json,report.md} using ngne-tooling format version 1. Manifest records contract version 1, runId, package filename/hash, installed identities, consumer revision/source/lock identity, and environment. Results use the independent outcome dimensions defined above; stage details and logs are referenced relatively. Preserve the tarball in delivered evidence. Reject an existing output destination and unsupported contract version before installation; failures after allocation retain partial evidence.

Exit codes: 0 only for completed required checks, successful cleanup, and complete evidence; 1 for execution/assertion/cleanup/evidence failure; 2 for invalid input or unsupported contract. NGNE validates both exit code and returned evidence, including package hash and run ID; zero exit with missing/mismatched evidence is failure. Child run IDs are distinct from an aggregate parent ID and recorded by the parent.

T1b includes valid, mismatched-hash, unsupported-version, reused-output, and incomplete-result contract examples plus an executable stub/conformance test. Record consumer-owner agreement or explicit unresolved status; do not claim agreement from this proposal. Engine-internal extraction may proceed while consumer implementation is blocked; T4 cannot complete without real consumer conformance through the generic runner. The real consumer remains external and is supplied explicitly; no game-specific runner is introduced.

The versioned executable contract is `tooling/evidence/consumer-contract-v1.ts` together with `tooling/tests/fixtures/consumer-contract-v1/`, owned by NGNE and implemented in T1b. It uses the shared evidence schema, verifies document discriminators and required fields, cross-document run IDs, selected package and consumer identities, outcome/exit consistency, artifact inventory hashes, and relative paths contained within the evidence root. T1b coordinates the schema seam with T2; it does not create a competing schema implementation. Record the validator revision/hash and fixture-set identity in compatibility evidence.

T4 invokes this validator on every consumer response, including failed responses; an invalid or incomplete response fails the engine compatibility gate even if the consumer exits zero. Preserve the original consumer failure alongside validation diagnostics. Missing required fields, unsupported versions, mismatched run IDs, changed artifacts, and escaping paths have negative fixtures. Keep v1 semantics stable; a breaking contract needs a new explicitly selected version, never silent fallback. The consumer may run the same conformance fixtures locally, but no published shared tooling package is required. This continuously detects schema drift after migration.

## Transport decision

Extract and adapt the existing custom RFC 6455 socket from browser-baseline.ts behind the shared CDP transport. Add no WebSocket package in this epic and no engine runtime dependency. Retain strict UTF-8/frame behavior and verify fragmentation, a reply at least as large as the documented 4.26 MB failure, real HeapProfiler.stopSampling and snapshot streams, pending-call failure, and bounded close. This decision preserves demonstrated capability; the historical failure does not prove every newer Node WebSocket has the same defect. Replacing the custom socket or adding a devDependency later requires a separate explicit decision with parity evidence.

## T1a/T1b deliverables and mechanical completion

T1a adopts the pack and delivers inventory/checker work; T1b delivers interoperability and baseline work. T1b can proceed alongside T2 after T1a. Create these named artifacts under plans/tooling/ (outside authoritative docs):

- migration-plan.md: the complete parent plan, with local links to design and ticket proposal.
- layout-and-evidence-contracts.md and jira-ticket-sequence.md: adopted versions of this review pack.
- surface-inventory.json: generated path/command/config/CI surface inventory at the recorded revision.
- coverage-map.json and coverage-map.md: machine-readable mapping and its rendered review table.
- retirement-map.json: old surface, replacement, proof reference, remaining users and deletion gate.
  T1b owns the remaining artifacts:

- consumer-command-contract.md and schema examples: self-contained v1 cross-repository contract.
- legacy-formats.md: exact supported reader variants and named fixture examples.
- ci-cost-baseline.json: timing provenance and proposed acceptance budget.

Add tooling/commands/check-migration.ts to enumerate tracked files under tests/, benchmarks/, tooling/, and .github/workflows/, root package scripts and relevant root build/typecheck config. Include newly introduced surfaces before T1a completion; distinguish engine tests explicitly rather than treating them as tooling. Freeze generated source IDs so retirement can be checked after paths disappear. Exclusions such as binary/historical evidence must themselves have rows and reasons.

The checker reports discovered/mapped/excluded counts and requires exact set equality, no duplicate IDs, valid owners/destinations, and no missing classifications. Adding a file, command, or CI surface without a mapping must fail. Assertion/workload coverage is a separate reviewed subtable with stable IDs and replacement proof; path-count equality alone cannot prove semantic coverage. Missing replacement proof prevents deletion, not completion of the initial planning table. Thus T1a can finish before replacement execution while retirement remains blocked mechanically.

T1a owns the checker, its regression tests, RULES.md, npm test discovery, and initial tooling typechecking. T1b owns the versioned consumer validator/stub and conformance fixtures, named legacy fixtures, and measured CI baseline. T1b completion requires an executable passing conformance suite and five baseline measurements; consumer-owner agreement may remain explicitly unresolved, but blocks T4 completion.

## CI cost and topology

Keep one Ubuntu verification job initially; this extraction does not justify duplicate installs/builds across new jobs. Build and pack once, reuse the verified prepared manifest for all applicable stages, and hash immutable input inventories once at preparation plus verification at trust boundaries. Use disposable served copies for mutation cases. Upload one evidence tree with always() behavior; do not also create/upload a duplicate ZIP in routine CI. Full exports and expensive benchmarks are explicit/manual jobs. Preserve fault-injection runs and root/nested checks. Require explicitly selected compatibility during migration only until replacement coverage passes. Steady-state default engine CI and its aggregate deployment gate must operate with all external consumers absent. Explicit compatibility jobs remain separate; when selected, their failures fail that job and any aggregate invocation that selected them.

Do not assume usable run history. The inspected workflow last changed in commit 2c91e4a; hosted history has not been queried for this revision. T1a freezes the full pre-migration revision and workflow hash before T2 starts. T1b deliberately measures five successful verification runs of that frozen revision, with deployment disabled. Those runs may execute alongside T2 against the frozen ref; they must never run against T2's changed working tree. This replaces the conditional historical-baseline premise with a required deliverable, without blocking internal extraction on hosted execution.

Record run IDs, revision/workflow hash, runner image, Node/browser versions, cache policy, total and per-stage duration excluding queue time, and artifact bytes in ci-cost-baseline.json. Record failed attempts too; do not selectively discard slow successful runs. If hosted execution is unavailable, T1b remains incomplete and T8/T10 cost acceptance stays blocked. This document does not launch hosted runs or authorize deployment.

Proposed acceptance budget: no more than 20% increase in median verification wall-clock across five matched final runs relative to the five frozen baseline runs. Final workflow contents intentionally differ; compare equivalent required coverage with matched runner/toolchain/cache conditions and an explicit old-to-new stage map. If environment drift prevents matching, rerun the frozen baseline under the final conditions. Report absolute per-stage durations and artifact bytes as well as the percentage. No timings or budget compliance are claimed yet. Use a 30-minute timeout as a hang guard; revise explicitly if the measured baseline exceeds it. Separate migration dual-suite overhead from steady-state cost. Measure final default engine verification with all external consumers absent; record explicit consumer integration cost separately. The coverage map must account for relocated consumer checks and the changed default scope, so removed consumer work cannot be reported as an engine speedup. Preserve the five-run comparison and budget, documenting the stage mapping and any explicit budget revision.

If the final budget fails, investigate duplicate work and upload/install costs first; propose splitting independent checks/browser execution with shared artifacts only on timing evidence. Splitting must preserve one required aggregate gate for deployment. T8 implements the chosen topology and T10 records budget evidence; neither may silently drop correctness checks to meet it.

## Migration and retirement

Move a complete workflow at a time, including command, tests, configuration, documentation, and CI artifact paths. Keep compatibility selected in migration CI until equivalent coverage passes, then remove it from default engine commands and CI before final acceptance. Retain only the generic opt-in invocation path.

Maintain a retirement map: old path or command, replacement, behavior/coverage owner, replacement proof, remaining references, and deletion decision. Candidates include old benchmark orchestration, tests/tooling, installed runners, mixed browser checks, archived consumer fixture copies, obsolete configs, and temporary aliases. Candidate status does not itself authorize deletion.

Before deleting executable code, prove replacement coverage and remove live imports/scripts/config references. Preserve engine tests. Move retained benchmark evidence to docs/evidence with byte/hash checks and corrected links; never discard original measurements. Consumer checks are retired from NGNE only after their consumer-owned replacements pass. Final acceptance searches for external consumer defaults or automatic retrieval, game-specific runners/assertions/schemas/configuration, embedded game snapshots, sibling paths, fixed tarball names, obsolete output paths, and duplicate runners. Clearly labeled inactive historical references and evidence remain permitted.
