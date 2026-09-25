# Tooling planning records

Updated 2026-09-25. Start with the [completion plan](migration-plan.md) for approved
scope, then the [local tickets](jira-ticket-sequence.md) for the selected task.
[Layout and safeguards](layout-and-evidence-contracts.md) preserve implementation
boundaries; [tooling/README.md](../../tooling/README.md) owns current command usage.
Planning documents do not establish fresh runtime validation.

## Status

T1a–T5 are delivered. T6 is complete under the approved exclusion of Linux benchmark
execution, using [historical Windows evidence](../../docs/evidence/benchmark-migration.md)
for implementation `a127e594de11b190f7d218364d0f4db08a1f9c69`.
The original machine record and backup handoff remain unchanged historical records.
T7 is complete on 2026-09-25: existing comparators/readers relocated with unchanged
semantics; 19 affected tests, 16 migration-checker tests, typechecks, formatting
and migration validation passed locally on Windows. T8 is next and has not started.

The remaining work is comparator relocation, practical verification/CI delivery,
safe removal of superseded code and final verification. Candidate comparison,
portable export and the five-run CI cost campaign are excluded; see the plan for
exact limits. Ordinary Linux verification and existing correctness/cleanup checks
remain required. There is no separate simplified runtime or weaker acceptance mode.

## Retained records

- [Surface inventory](surface-inventory.json), [coverage map](coverage-map.json)
  ([rendered](coverage-map.md)) and [retirement map](retirement-map.json).
- [Consumer command contract](consumer-command-contract.md) and
  [legacy reader fixtures](legacy-formats.md).
- [Installed coverage](installed-engine-coverage.md),
  [installed evidence](../../docs/evidence/installed-engine.json),
  [browser infrastructure](../../docs/evidence/browser-sessions.json) and
  [consumer separation](../../docs/evidence/consumer-retirement.md).
- [Historical CI cost record](ci-cost-baseline.json) and
  [raw provenance](ci-baseline-evidence/README.md): five successful baseline runs,
  one retained failure and a 161-second median. One successful-attempt ZIP was lost;
  no payload inspection is claimed for it. The old 20% proposal is not an active
  completion gate, and these results establish no current speedup.

## Frozen baseline

The checker reconstructs frozen surfaces from revision
`7d7585ede1aa25147b423f48c9c7f1339678f280` and recorded workflow hashes.
Preserve these identities and their Git history; scope simplification does not
erase unfulfilled replacement obligations.

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
