# Tooling migration planning records

This directory adopts the complete review pack for implementation. It is planning
and ownership data, not authoritative engine documentation or proof that the
planned runners already exist. Operational checker usage lives in
[tooling/README.md](../../tooling/README.md).

- [Migration plan](migration-plan.md)
- [Layout and evidence contracts](layout-and-evidence-contracts.md)
- [Epic and ticket sequence](jira-ticket-sequence.md)
- [Surface inventory](surface-inventory.json)
- [Coverage map](coverage-map.json) and [rendered table](coverage-map.md)
- [Retirement map](retirement-map.json)

## Frozen baseline

The inventory freezes the full pre-migration revision
`7d7585ede1aa25147b423f48c9c7f1339678f280` and the SHA-256 of each workflow's
Git blob bytes. The checker reconstructs the frozen surfaces and assertion IDs
from that revision, rather than trusting an editable count. It also records
current surfaces introduced during adoption. T2 must not replace this baseline
with its changed working tree.

T1b recorded five deliberate successful complete hosted measurements at that frozen
revision, with deployment disabled, plus 1 retained failed attempt. The
[CI cost record](ci-cost-baseline.json) contains per-stage and queue-excluded wall
durations, runner/toolchain/browser/cache provenance and artifact identities/bytes.
The median is **161 seconds**. [Raw provenance](ci-baseline-evidence/README.md)
records a lost successful-attempt ZIP and the retained logs/metadata; no payload
inspection is claimed for that attempt.

The baseline spans multiple hosted environment versions. Final acceptance still
needs five matched final runs, the proposed median growth budget of at most 20%,
and an explicit stage map for relocated consumer checks. Match recorded conditions
or remeasure the frozen baseline under final conditions; do not discard slow
successful runs or treat consumer removal as an engine speedup. The baseline is
historical workload evidence, not validation of later tooling. Consumer-owner
agreement and passing real pinned conformance are recorded in the consumer command contract.

## Inventory and review method

File discovery covers `tests/`, `benchmarks/`, `tooling/`, `.github/workflows/`,
root package scripts/lockfile, root build/typecheck configs, formatting config and
ignore policy. Both tracked files and nonignored untracked additions are checked;
ignored generated output and `.tickets` are outside discovery. Missing tracked
paths remain frozen obligations. Root config filenames follow `*config.json`,
`*config.[cm]?[jt]s`, or `tsconfig*.json`; a new naming convention must extend the
checker rather than silently escape the inventory.

Each nonblank, noncomment workflow line is a CI surface. This deliberately covers
conditions, environment, artifact delivery, nested steps and multiline commands
without a partial YAML step parser. IDs hash normalized line content plus its
occurrence. Runner option discovery conservatively includes literal CLI switches,
NGNE environment names, Chrome override and GitHub summary paths, plus PowerShell
orchestrator parameters. Internal child-process switches are included too.

Assertion rows represent named unit test scenarios and browser/runner `check`,
`verify`, `assert` and `passed.push` sites. IDs hash path and normalized label;
identical labels are a single source scenario. Dynamic helpers and loops are not
expanded into invented runtime counts. Unit cases cover their nested assertions;
workload review covers inline browser instrumentation, throwing guards, sampling,
profiler capabilities and cleanup. The subtables are reviewed obligations, not a
claim that syntactic discovery proves semantic equivalence. When adding a new
assertion helper, extend discovery or add an explicitly reviewed workload row.

Ownership review separates existing engine tests from tooling tests; mixed
installed-content assertions split generic lifecycle/asset/audio/recovery behavior
from game controls, authored actor composition, collision, saves, sessions and
checkpoint progression. Generic behavior must be proved with the new minimal
installed fixture; its old Town/Dungeon scenario remains migration coverage until
the corresponding consumer checks pass. Game-specific source and configuration
must leave active NGNE paths even when some embedded assertions have engine
owners. The file row's retirement gate covers all of its assertion obligations.

`tests/fixtures/town-dungeon.json` and its archive were consumer fixtures,
not historical exclusions. Their removal has passed exact engine and external-consumer
replacement gates. `benchmarks/evidence/*` are explicit historical exclusions
whose bytes must survive later relocation under `docs/evidence/`. Other existing
evidence under `docs/evidence/` stays intact and outside executable discovery.

## Schemas and retirement

Planning JSON uses `format: ngne-tooling`, `schemaVersion: 1`, a shared planning
`runId`, and separate `migration-inventory`, `migration-coverage` and
`migration-retirement` document types. This ID identifies an inventory snapshot,
not a runtime test run. The checker validates loaded fields, versions, exact ID
sets, uniqueness, owner/destination constraints, exclusions and retirement rows.
These planning schemas are not the runtime evidence schema to be shared by T1b
and T2. Do not implement a competing consumer schema here.

Every migrate/remove mapping has its own retirement row. Initially every such
row is blocked, has null proof, and names the existing user and its replacement
gate. Unknown proof does not prevent T1a completion. Removing an inventoried
surface or assertion without approved proof does fail. A retained or excluded
row cannot disappear silently either.

Later approval requires zero declared remaining users and a repository-relative,
hash-verified JSON proof record with `documentType: migration-replacement-proof`,
the shared format/version, its own run ID, `status: passed`, `coverageIds`, matching
`destination`, a named `reviewedBy` and an `evidence` reference. Each obligation
must be named; a whole-file assertion count is insufficient. Review actual passing
replacement evidence and search remaining imports/config/commands before signing
such a record. The checker verifies the recorded decision and proof identity; it
does not independently judge semantic equivalence or replace that review. The
final retirement audit must inspect live references and rerun affected checks.

Frozen IDs never change. Current inventory and new reviewed rows grow during
migration; absent frozen IDs still need proof. New workload definitions need
stable semantic IDs and new baselines when their inputs or methods change.

## Command compatibility and required checks

Migrated aliases and retired consumer options are documented in the tooling guide.
`bench:compare` stays an
advisory scan: default attention threshold 10%, compatibility warnings, problems,
metric direction, regressions/improvements and scan-result precedence are retained.
It is not an acceptance gate or statistical significance claim. The content
comparator retains strict identities and cleanup acceptance until its extraction.
Legacy readers stay bounded to content-legacy and benchmark-legacy; curated
historical documents receive no conversion adapters.

CI requires formatting, both test directories, root and tooling typechecks,
migration checking, existing builds, browser fault injections, browser integration
and installed root/nested validation. Consumer-owned checks passed through the
generic explicitly selected invocation before the embedded archive and default
consumer stages were retired. Default commands and CI now require only engine
inputs; the frozen baseline workflow remains a separate historical measurement.
Benchmarks and full diagnostic exports remain explicit operations, not ordinary
CI prerequisites. Unselected compatibility makes no claim; once selected,
it must fail on missing prerequisites, bad evidence, scenario or cleanup failures.

## Environment and export policy

Existing environment prerequisites still apply: Node 24, documented Chromium,
visible physical-GPU measurement where required, and Linux Xvfb/software-WebGPU
dependencies for hosted presentation checks. Record Windows/Linux, browser/GPU,
flags, viewport/DPR, visibility, toolchain, workload, harness and policy identities.
Software GPU, physical GPU and manual visual/audible results remain distinct.
Future named profiles must validate observations; exploratory runs are not
accepted baseline measurements.

The adopted evidence contract requires portable relative paths, runtime schema
validation, immutable package/build identities, independent execution/correctness/
budget/cleanup/completeness outcomes, atomic progress records and finalization
after cleanup. Default export retains manifests, results, report, artifact
inventory, package, raw measurements, observations, logs and required diagnostics.
Full export may add fixture builds, traces and heaps. Declare omissions and their
limits; never export dependencies, caches or browser profiles. Preserve failed
evidence and old outputs. T2 begins this implementation; T8 completes export and
aggregate delivery. No exporter or new runtime proof is claimed here.

## Interoperability and baseline status

T1b is complete: the [consumer command contract](consumer-command-contract.md),
shared-schema validator/synthetic conformance fixtures, [bounded legacy formats](legacy-formats.md)
and [five measured baseline executions](ci-cost-baseline.json) are delivered.
Consumer-owner agreement and real pinned conformance are recorded in the contract;
T4's exact retirement/default-CI separation and independent executions have passed.
The [deployment-disabled measurement workflow](../../.github/workflows/ci-baseline.yml)
is published on the existing feature branch. Its scoped automatic trigger does not
run on a main merge. Ordinary verification retains the deployment dependency while
removing consumer stages. T8/T10 matching, coverage and budget gates remain in force;
only the 258 reviewed consumer-separation obligations are approved for retirement.

## Installed engine verification status

T3 introduces `npm run verify:installed` and an engine-owned installed fixture.
See [coverage correspondence](installed-engine-coverage.md) and the
[dated local evidence](../../docs/evidence/installed-engine.json). The later
[retirement evidence](../../docs/evidence/consumer-retirement.md) records expanded
engine assertions and final consumer-free executions. T5 browser-session consolidation
is delivered below; consumer checks now execute only when explicitly selected.

## Browser infrastructure status

Browser-session consolidation is implemented across browser verification, installed
verification and the browser/content benchmark runners. Shared process-tree cleanup
and transport remain at their compatibility entry points; the benchmark's duplicate
CDP/socket implementation is removed after local wire/profiler parity checks.
See [browser infrastructure evidence](../../docs/evidence/browser-sessions.json) for
the measured revision, environments, raw selected records and limits. Linux execution
is configured in CI but was not available locally. This does not waive final hosted
coverage/cost acceptance or consumer migration gates.

T4 has owner agreement and passing pinned real consumer conformance. Embedded
consumer execution is retired after exact assertion/workload review; see
[consumer retirement evidence](../../docs/evidence/consumer-retirement.md).
Ordinary verification/default CI are engine-only, while compatibility requires
explicit checkout and revision selection. Historical status paragraphs above
describe the earlier adoption and migration stages.

T6 is implemented and locally verified on Windows, but remains incomplete pending
Linux execution. Node orchestration replaces the two PowerShell scripts after
scoped replacement proofs; compatibility entry points and unrelated retirement
gates remain. The installed resource workload now has named observed-environment
profiles, exploratory/baseline/controlled modes and a measured local budget.
See [benchmark migration evidence](../../docs/evidence/benchmark-migration.md).
T7 remains blocked on T6; strict/candidate comparator implementation, final hosted
coverage and matched CI-cost acceptance are not included or waived. Operational
usage belongs in the [tooling guide](../../tooling/README.md).
