# NGNE repository rules

## Authority and scope

- Architecture and implementation contracts outrank style preferences. Read the
  relevant documents before changing behavior.
- Preserve public contracts unless the task intentionally changes them.
- Apply changes only to the affected surface. Do not perform unrelated rewrites.

## Design and ownership

- Prefer the smallest solution with a current consumer. Reuse local patterns
  before adding abstractions, dependencies, options, or extension points.
- Keep mutable state with its explicit owner.
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
  or tooling dependencies. Keep consumer tests with their consumers and tooling
  tests and shared runners with tooling. Follow [tooling guidance](tooling/README.md)
  for locations and commands. Split mixed suites by owner and
  preserve test discovery, browser checks, and typecheck coverage when moving files.
- Validate browser-dependent changes in a browser and report the environment
  and anything not tested.
- For hot-path changes, record relevant before/after measurements, workload,
  environment, and method. Treat results as evidence for that workload, not as
  universal performance claims.
- Run checks appropriate to the affected surface. Documentation-only changes
  require consistency and link checks, not unrelated test suites.

## Documentation

- Keep documentation short, compact, and easy for humans and agents to scan.
  Document current usage and contracts; omit ticket identifiers and issue-tracker
  links from repository documentation and generated reports.
- Each topic has one authoritative owner: architecture for the high-level model,
  contracts for exact semantics, and the guide and examples for usage. Link to
  that owner rather than maintain competing specifications. Keep consumer-specific
  details in consumer documentation and work tracking outside authoritative docs.
- Update the owning document in the same task as an observable behavior or
  public API change.
- Separate current behavior from proposals and historical evidence. Label evidence
  with its date, revision, environment and limits; it does not define current
  contracts or validate later revisions. Preserve recorded results and existing
  evidence artifacts during editorial cleanup.
- Documentation restructuring must preserve conditions, exceptions, ordering
  guarantees and limits. Report contradictions between documents or implementation
  rather than silently resolving them as editorial changes.
