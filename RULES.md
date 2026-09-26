# NGNE repository rules

## Authority and scope

- Architecture and implementation contracts outrank style preferences. Read the
  relevant documents before changing behavior.
- Preserve public contracts unless the task intentionally changes them. Keep
  authoritative documentation aligned with the current implementation.
- Apply changes only to the affected surface. Do not perform unrelated rewrites.

## Design and ownership

- Prefer the smallest solution with a current consumer. Reuse local patterns
  before adding abstractions, dependencies, options, or extension points.
- Keep mutable state with its explicit owner. Preserve capability, lifecycle,
  ordering, borrowing, and cleanup boundaries defined by the contracts.
- Keep controllers, progression, collision rules, and other game mechanics in
  games. Promote capabilities into NGNE only after demonstrated reuse.
- Do not widen the public package surface for implementation or testing
  convenience.
- Do not bypass public API relationships with `any`, unchecked assertions, or
  leaked internal type erasure. Keep necessary ECS type erasure private and
  document its invariant.

## Validation and performance

- Cover non-trivial behavior changes with focused regression tests. Use fixed
  seeds and controlled clocks or promises for deterministic behavior.
- Reserve `tests/` for `src/` tests and engine-only fixtures; no demo, example,
  or tooling dependencies. Put consumer tests in `demo/tests/` or
  `examples/<name>/tests/`, tooling regressions in `tooling/tests/`, and shared
  runners/browser orchestration in `tooling/`. Split mixed suites by owner and
  preserve test discovery, browser checks, and typecheck coverage when moving files.
  Typecheck Node tooling with `npm run typecheck:tooling`.
- Validate browser-dependent changes in a browser and report the environment
  and anything not tested.
- For hot-path changes, record relevant before/after measurements, workload,
  environment, and method. Treat results as evidence for that workload, not as
  universal performance claims.
- Run checks appropriate to the affected surface. Documentation-only changes
  require consistency and link checks, not unrelated test suites.

## Documentation and completion

- Keep documentation short, compact, and easy for humans and agents to scan.
  Document current usage and contracts; omit ticket identifiers and issue-tracker
  links from repository documentation and generated reports.
- Each topic has one authoritative owner: architecture for the high-level model,
  contracts for exact semantics, and the guide and examples for usage. Other
  documents may summarize or demonstrate it and link to that owner; they must not
  maintain competing specifications. Consumer-specific configuration and mechanics
  belong in consumer documentation. Tests and CI provide executable evidence;
  work tracking and history stay outside the authoritative documentation.
- Update the owning document in the same task as an observable behavior or
  public API change.
- Keep current behavior distinct from proposals and historical records.
- Historical validation records may live under `docs/evidence/`. Identify their
  recorded date, revision, environment and limits; they do not define current
  contracts or establish validation of later revisions. Editorial cleanup must
  preserve recorded results and existing evidence artifacts.
- Documentation restructuring must preserve conditions, exceptions, ordering
  guarantees and limits. Report contradictions between documents or implementation
  rather than silently resolving them as editorial changes.
- On completion, report changes, checks and results, remaining limits, and
  unresolved decisions.
