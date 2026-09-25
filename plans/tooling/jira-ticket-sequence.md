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

Completed: T1a, T1b, T2, T3, T5, T4, T6, T7, T8.
Remaining: T9 → T10.

Each ticket includes its affected tests, command/docs updates and existing migration
map maintenance. Do not automatically start the next ticket.
