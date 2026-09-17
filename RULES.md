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
- Keep unit and contract tests in the existing `tests/*.test.ts` harness. Use
  the existing browser and benchmark harnesses for those concerns.
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
- Each fact has one owning document: architecture for the high-level model,
  contracts for exact semantics, and the guide and examples for usage. Tests and
  CI provide executable evidence; work tracking and history stay outside the
  authoritative documentation.
- Update the owning document in the same task as an observable behavior or
  public API change.
- Keep current behavior distinct from proposals and historical records.
- On completion, report changes, checks and results, remaining limits, and
  unresolved decisions.
