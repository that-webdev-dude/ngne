# Tooling ticket sequence

Local implementation tickets, updated 2026-09-25. These labels are not Jira keys.
The [completion plan](migration-plan.md) owns scope and exclusions; the
[layout and safeguards](layout-and-evidence-contracts.md) apply to every ticket.
Execute only the selected ticket. Implementation and external actions require
their applicable authorization.

## Completed foundation

| Ticket | Delivered work / retained record                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| T1a    | Inventory, coverage map, retirement gates, migration checker and tooling test/typecheck discovery.                                            |
| T1b    | [Consumer contract](consumer-command-contract.md), [legacy fixtures](legacy-formats.md), and [historical CI baseline](ci-cost-baseline.json). |
| T2     | Isolated package preparation, exact-manifest reuse, identities and run lifecycle.                                                             |
| T3     | [Installed engine verification](../../docs/evidence/installed-engine.json).                                                                   |
| T5     | [Shared browser infrastructure](../../docs/evidence/browser-sessions.json).                                                                   |
| T4     | [Consumer separation and explicit compatibility](../../docs/evidence/consumer-retirement.md).                                                 |

These are delivered work records, not fresh validation of later changes. Historical
CI timing data is preserved; repeating its five-run campaign is no longer a gate.

## T6. Migrate engine benchmarks and replace PowerShell orchestration

Complete on 2026-09-25 under the user-approved exclusion of Linux benchmark
execution. Accepted implementation: `a127e594de11b190f7d218364d0f4db08a1f9c69`.
Acceptance uses the [historical Windows evidence](../../docs/evidence/benchmark-migration.md);
no benchmark was rerun to close the ticket.

Node orchestration, CPU/rendering workloads and installed engine resource churn
are delivered with existing flags, diagnostics, compaction, identities and cleanup.
Named profiles and exploratory/baseline/controlled modes remain supported. The
original machine record and backup handoff retain their dated incomplete status;
the approved scope decision supersedes their Linux blocker, not their results.

## T7. Relocate existing comparators without behavior changes

Dependencies: T6 and the existing legacy fixtures. Status: complete, 2026-09-25.

Comparators and the shared aggregate reader now live in `tooling/evidence/`;
callers, npm entry point and existing migration maps/proofs are updated. Strict
comparator/reader bytes are unchanged; the advisory comparator changes only its
repository-root depth. No compatibility entry points were needed after caller audit.

Validation: 19 affected comparator/reader/compaction/runner tests and 16 migration
checker tests passed; root/tooling typechecks, full formatting, migration validation
and npm help passed. Windows runner fixtures required CIM access for cleanup; the
restricted attempt failed closed and its evidence was retained. No benchmark,
browser or hosted job ran. Existing output hashes match the unique backup.

Changes:

- Move the strict content comparator, aggregate advisory comparator and required
  reader helpers into tooling. Reuse their implementations and existing fixtures.
- Update npm entry points, imports, tests and documentation. Keep thin compatibility
  entry points only where callers still require them.
- Update the existing migration maps for moved surfaces and replacement checks.

Acceptance:

- Preserve supported input families, arguments, exit codes and output shapes.
- Preserve strict identity/acceptance/cleanup gates and advisory warnings,
  problems, default 10% attention threshold, metric directions and scan precedence.
- Existing valid/invalid, per-stage/consolidated/compact and tampering tests pass.
  Add focused coverage only for behavior at risk from the move.
- Unsupported formats stay unsupported; no accepted performance conclusion is
  invented for invalid or incompatible data.
- Relevant typechecks, formatting and migration checks pass.

No candidate mode, new-format comparator, identity redesign, merged comparison
framework, new reporting system or benchmark campaign.

## T8. Finish verification commands and CI artifacts

Complete on 2026-09-25 for implementation `ef856e6f27f498e8288a671ae402334b3963a23a`.
Local verification passed. [Ordinary Ubuntu CI run 36171850842](https://github.com/that-webdev-dude/ngne/actions/runs/36171850842)
passed all required checks: 275 tests, installed root/nested checks (60 each),
transport/profiler checks, all three failure injections and 189 browser assertions.
Downloaded artifact `10880726507` contains 122 files; all 39 indexed payload hashes
and sizes matched. Package tarball, fixture builds, browser inputs, logs, failure
records and cleanup results were inspected. Real resources cleaned up successfully;
the controlled cleanup failure correctly rejected otherwise passing validation.
No dependency, cache, work or browser-profile directories were uploaded. Deployment
was skipped. Logs and the downloaded artifact are retained in ignored
`out/ci/t8-36171850842/`. This is Ubuntu/SwiftShader evidence, not physical-GPU,
manual, benchmark or consumer-compatibility acceptance. Documented payload omissions
and local-only preparation requirements remain unchanged.

Dependencies: T7.

Changes:

- Add or finish one thin local engine-verification entry point by composing the
  existing checks; document its explicit check list. Keep individual commands usable.
- Reuse one exact verified package preparation where applicable. Preserve current
  tests, root/nested installed checks, browser integration, profiler capability
  and failure-injection checks in ordinary CI.
- Keep one Ubuntu verification job. Upload existing required evidence on success
  and failure, including logs and cleanup results, without duplicate ZIP exports.
- Keep benchmarks and consumer compatibility explicitly selected. Update command
  documentation and existing migration maps.

Acceptance:

- Local and CI execution use the same underlying operations and acceptance rules.
  Missing or failed required stages cannot yield aggregate success.
- Artifact uploads retain the records and payloads needed to inspect each selected
  check. Document omissions and any local-only preparation requirements; do not
  claim an upload is a portable/resumable preparation.
- Do not upload dependencies, caches or browser profiles. Failed evidence survives.
- Appropriate regression checks pass; demonstrate the command and inspect artifact
  delivery in an authorized ordinary CI run. Missing hosted evidence remains open.

No exporter, new evidence schema, default/full export modes, speculative build/job
splitting, timing campaign or new comparison behavior.

## T9. Remove superseded tooling

Dependencies: T8.

Complete locally, 2026-09-25, on `147acd0` plus the uncommitted retirement changes.
Removed five benchmark forwarding files after direct replacement checks; the
browser page imports the renderer implementation directly. Active usage references,
inventory and 18 existing retirement obligations are reconciled. The remaining
92 blocked rows protect retained live code, tests, browser entry/configuration and
compatibility seams; no gates were waived. Shared `tests/tooling` helpers, engine
tests, supported readers, diagnostics, npm aliases and browser page remain active.

Validation: all 275 tests (including migration regressions), tooling typechecks,
production/browser builds, formatting and migration checks passed. Direct CPU
execution and churn timed/allocation/GC/compaction passed; the first diagnostic
attempt rejected GC alignment, then a fresh retry passed unchanged validation.
A headless Chrome renderer smoke passed with owned browser/server/profile cleanup.
No active caller references removed paths; default verification still uses only
engine-owned inputs, with explicit compatibility separate. All 147 pre-existing
historical evidence files retain identical hashes. Old outputs and backups were
not pruned or relocated. Logs and failed attempts remain under `out/t9/`.

Limits: Windows local checks and headless capability only; no new performance,
physical-GPU, manual, Linux benchmark or consumer-conformance claim. The restricted
test attempt could not complete Windows process cleanup; its identified process
tree was stopped and the normal-access rerun passed. Test relocation was abandoned
after exposing existing helper declaration gaps; original tests remain unchanged.
No hosted job or external action ran during T9. Final-revision Linux CI and repeated
final verification were subsequently completed in T10 below.

Changes:

- Remove duplicate implementations, obsolete configuration and unused migration
  shims only after replacement coverage passes and live callers are updated.
- Reconcile existing inventory/coverage/retirement records. Preserve engine tests,
  supported readers, diagnostics and cleanup safeguards.
- Fix active command and documentation references. Relocate retained evidence only
  when needed for directory cleanup, preserving bytes/hashes and links.

Acceptance:

- No active caller references removed code. Default engine tooling has no consumer
  dependency, automatic retrieval, embedded game snapshot or game-specific adapter.
- Existing migration checks and affected tests/builds pass after removal.
- Remove legacy directories only when all responsibilities have moved; a necessary
  compatibility entry point is not deleted merely to satisfy an empty-folder target.
- Old output directories, backups and historical evidence remain preserved.

No wholesale evidence conversion, new retirement framework or broad filesystem cleanup.

## T10. Verify final tooling

Dependencies: T9.

Complete on 2026-09-25 for `1dc93c33341737c3a67ec27e129d09b716abc58c`.
Two local engine verification runs, two passing Windows aggregate benchmark runs
(including diagnostics/compaction), two full installed-resource runs, regression
checks and the reference/docs audit passed. The initial visibility rejection and
all prior outputs remain preserved; no benchmark campaign was repeated.

[Ordinary Linux CI run 36185110376](https://github.com/that-webdev-dude/ngne/actions/runs/36185110376)
passed all required checks, including 275 tests, installed root/nested checks
(60 assertions each), transport/profiler checks, three failure injections and
189 browser assertions. Downloaded artifact `10885298342` contains 122 files;
its ZIP digest and all 39 indexed payload hashes/sizes matched. Logs, failure
records and cleanup were inspected. Deployment was skipped.

Explicit Town/Dungeon integration passed with the clean consumer pinned to
`c04cf1d013a57773a59a601ff0994f5e6bee1864` and an exact verified preparation of
the final engine revision: 66 deterministic tests and 111 browser assertions at
each base. Parent and consumer acceptance and cleanup passed with zero failures;
the consumer remained unchanged. All 462 indexed local/CI/integration payloads
and 65 historical evidence files passed preservation checks. The 92 blocked
retirement rows still protect retained code; none was waived.

The [final handoff](../../out/t10/20260925-final-verification/HANDOFF.md) and its
adjacent logs, downloads, audits and separate integration evidence are retained
locally under ignored `out/t10/20260925-final-verification/`. Fresh CI and consumer
browser results are automated SwiftShader evidence; prior Windows exploratory
benchmark limits remain unchanged. No physical-device, manual visual/audio,
Linux benchmark or performance-baseline claim. No acceptance blockers remain.

Changes and acceptance:

- In a clean checkout with documented dependencies/browser prerequisites, run the
  final engine verification command twice locally without manual cleanup or external
  consumers. Retain separate outputs and verify cleanup.
- Obtain a passing ordinary Linux CI verification run with its existing browser,
  failure-injection, installed-package and artifact-delivery checks. A final-revision
  run already obtained during T8/T9 may be reused; missing execution blocks completion.
- Run the existing Windows benchmark entry points twice without manual cleanup;
  use bounded exploratory execution and one diagnostics/compaction run. Preserve
  full prescribed samples for the selected modes; claim no new performance baseline.
- Run existing relevant tampering, stale-emission, partial-result, diagnostic and
  cleanup regression tests. Add fault scenarios only for demonstrated changed risks.
- Audit active references and migration gates; verify final commands and docs agree.
- Reuse prior real consumer conformance if its runner/contract and relevant inputs
  remain unchanged. Otherwise validate the changed path and rerun explicit integration
  with authorized pinned inputs; report missing integration as a blocker.
- Record revision, commands, results, environments and limits in a compact handoff.
  Distinguish automated software-GPU, physical-GPU and manual evidence.

No Linux benchmark runs, five-run CI cost comparison, 20% timing budget,
candidate-comparison acceptance or portable-export acceptance.

## Sequence

Completed: T1a, T1b, T2, T3, T5, T4, T6, T7, T8, T9, T10.
Remaining: none within the approved scope.

Each ticket includes its affected tests, command/docs updates and existing migration
map maintenance. Do not automatically start the next ticket.
