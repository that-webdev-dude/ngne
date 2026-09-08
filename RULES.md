# NGNE coding and documentation rules

Adapted from CE2's coding style guide for NGNE's contracts, public API, test
layout, and performance requirements.

## Precedence and adoption

- Architecture and contract documents outrank style preferences. Start with
  [architecture](docs/architecture.md), [capabilities](docs/capabilities.md),
  [decisions](docs/decisions.md), and the relevant [implementation contracts](docs/contracts/NGNE.md).
- Style does not redefine behavior, ownership, lifetime, ordering, or cost.
- Apply these rules to new and modified code. Address existing substantive
  violations through focused stability work; avoid unrelated style rewrites.
- Preserve public contracts unless the task intentionally changes them. Record
  API changes and migration guidance together.
- Formatting is automatic: run `npm run format` (Prettier) before committing;
  `npm run format:check` runs in CI. `.editorconfig` and `.gitattributes` fix
  4-space indentation and LF line endings. Do not hand-format or add other
  formatting machinery for an unrelated change.

## General

- Use the simplest construct that makes ownership and behavior clear.
- Reuse local patterns before adding abstractions, dependencies, options, or
  extension points. Each addition needs a current consumer.
- Prefer direct code over forwarding-only wrappers. Capability boundaries such
  as `WorldAccess` have a real ownership purpose and must remain intact.
- Keep mutable state with its explicit owner. Avoid process-global mutable
  state, singletons, service locators, and ambient registries.
- Keep controllers, level progression, and game rules game-owned. Promote a
  capability into the engine only when a demonstrated reusable need justifies it.

## Constructs and helpers

| Need                                           | Usual construct                    |
| ---------------------------------------------- | ---------------------------------- |
| Data without behavior                          | Plain object                       |
| Stateless transformation                       | Function                           |
| Small stateful capability                      | Factory function or class          |
| Identity, lifecycle, or many similar instances | Class when clearer                 |
| Platform interoperability                      | Construct required by the boundary |

- Name factories `createX`. Choose closures or fields for clarity, while keeping
  authoritative state inspectable wherever the contracts require it.
- Prefer composition. Use inheritance only for a required platform or framework
  boundary, such as extending `Error`.
- Bind dependencies through parameters or constructors.
- Add interfaces for real consumer boundaries, hidden representations, or actual
  alternatives such as injected test fakes; not hypothetical implementations.
- Avoid getters that perform surprising work.
- Keep stateless private helpers at module scope, below the primary export in
  call order. Avoid nested functions that capture nothing.
- Prefer pure helpers when equally clear. Effects and cleanup are appropriate
  when the responsibility and affected owner are explicit.
- Do not export helpers solely for tests.

## Naming

- Name responsibilities and domain concepts. Avoid type-category prefixes and
  suffixes such as `IFrameClock`, `FrameClockImpl`, and `EStatus`.
- Avoid vague names such as `helper`, `util`, and `manager` unless established
  domain terminology makes them meaningful.
- Use verb phrases for functions, `is` / `has` / `can` for predicates, `createX`
  for factories, and `toX` / `fromX` for conversions.
- For new lookup APIs, prefer `findX` for an optional result and `getX` for a
  required result that throws when absent. Existing `World.get()` intentionally
  returns `undefined` on a miss; preserve that contract.
- Use `camelCase` for values/functions, `PascalCase` for types/classes,
  `SCREAMING_SNAKE_CASE` for true module constants, and `kebab-case` for files.
- Include units where ambiguity matters: `delaySeconds`, `widthPx`, `durationTicks`.
- Use plural collection names. Avoid abbreviations except established domain
  terms and short loop indices.
- Keep exported names clear at call sites without redundant module names.

## Types

- Use `interface` for named object contracts and `type` for unions, function
  types, aliases, and mapped or conditional types.
- Use `unknown` and narrowing at untyped boundaries. Do not introduce `any` or
  double assertions to bypass public API relationships.
- If heterogeneous ECS storage requires internal type erasure, isolate it at the
  smallest private boundary and document the invariant that restores the type.
  It must not leak unsafe types to consumers. Existing casts are not precedent
  for adding unchecked casts elsewhere.
- Avoid non-null assertions. Narrow or fail with a useful error. Keep necessary
  assertions local to a checked boundary or an invariant TypeScript cannot express.
- Prefer string-literal unions to enums; add an `as const` value object only
  when runtime values are needed.
- Give exported functions explicit return types while preserving useful generic
  inference for component and query consumers. Infer internal implementation types.
- Add generics only to preserve real relationships; use descriptive role names.
- Mark consumer-nonmutable properties and arrays `readonly`. Runtime immutability
  is a separate contract and requires its own enforcement where specified.
- Use `undefined` for absence, and `null` only when required by a contract.
  Optional properties mean missing, not empty.

## Modules, imports, and exports

- Keep each file cohesive, including its types, constants, and private helpers.
  Split at real ownership or reuse boundaries, not a line-count threshold.
- Avoid new catch-all files such as `utils.ts`, `types.ts`, or `common.ts`.
- Avoid internal barrel chains. Deliberate public package/subsystem entry points
  may re-export their intended surface.
- Order files as imports, module constants, types, primary exports, then helpers.
- Prefer named exports; use defaults only where an external boundary expects them.
- Use `import type`. Group external imports before internal imports with a blank
  line between groups, alphabetically within each group.
- Match the repository's import-extension convention.

## Errors and async work

- Throw `Error` or a fitting built-in subclass, never arbitrary values. Add
  custom subclasses only when callers need to distinguish them.
- Describe what failed and include safe identifying context. Use sentence case,
  no trailing period, and no `Error:` prefix. Exclude secrets and whole buffers
  or objects. Exact wording is a contract only when consumers depend on it.
- Return an optional value or result for expected misses. Throw for invalid
  input or broken contracts unless the contract specifies another mechanism.
- Validate authored, external, untyped, and contract-defined trust boundaries.
  Avoid redundant validation in trusted hot paths merely because an API is public.
- Preserve original errors with `{ cause }` when adding context. Use
  `AggregateError` for independent cleanup failures.
- Catch to recover, clean up, add context, translate, or deliberately contain a
  fault at a documented boundary. Do not silently swallow ordinary failures or
  merely log and rethrow unchanged.
- Diagnostic callback failures may be intentionally contained, as in
  `Game.report()`, so reporting cannot change simulation behavior. Explain such
  containment in a comment; do not recursively report through the failing callback.
- Prefer `async` / `await` for sequential work. Promise handlers are appropriate
  where they make lifecycle ownership clearer.
- Await, return, or deliberately handle every promise. Detached work handles its
  own rejection. Pass cancellation explicitly.
- Name async functions for their work without an `Async` suffix. Use `async`
  without `await` only for a required Promise boundary.

## Mutation and performance

- Use `const`, or `let` when the binding changes. Do not use `var` or reassign parameters.
- Prefer new values for small immutable data when equally clear. Mutate owned
  state, typed arrays, and reusable buffers directly where appropriate.
- Make argument mutation explicit through the signature and documentation or a
  name such as `target` or `out`. Domain names such as `position` are appropriate
  for deliberately mutable ECS component access.
- Expose mutable internal collections only where the contract grants a borrowed
  view and defines its validity and mutation rights.
- Avoid unnecessary hot-path allocations, copies, and repeated work. Preserve
  determinism, ownership, and ordering when optimizing.
- For changes affecting hot-path performance, record relevant before/after
  measurements, workload, environment, and measurement method. Evaluate sustained
  load and memory behavior where affected, not just a single frame.
- Treat local benchmarks as evidence for that workload and environment, never
  as universal throughput or frame-rate guarantees.

## Comments and tests

- Explain constraints, non-obvious decisions, and conditions for revisiting
  shortcuts. Do not restate code, add banner dividers, or leave commented-out code.
- A `TODO` names an owner or a condition that resolves it.
- Use JSDoc where signatures cannot express units, validity, ordering, ownership,
  or failure behavior.
- Follow the existing central `tests/` layout. Unit tests use `*.test.ts`;
  contract tests may use `<unit>.contract.test.ts`, which the current test command
  also discovers. Keep browser validation and benchmarks in their existing harnesses.
- Name tests for observable behavior and test one coherent behavior at a time.
- Exercise public or intentional module boundaries. Fake injected dependencies,
  not the unit under test; do not expose private state solely for tests.
- Use fixed seeds and injected clocks for deterministic simulation tests.
  Real-browser lifecycle checks and timing benchmarks should state environmental limits.
- Cover non-trivial behavior changes with focused regression tests. Run checks
  appropriate to the affected surface; documentation-only changes need link and
  consistency checks, not a new test suite.

## Documentation and completion

- Use plain language, literal headings, short sections, bullets, tables, and
  compact examples. Keep technical detail needed to implement or use a contract.
- Prefer focused Mermaid diagrams when they clarify structure, relationships,
  workflows, or data flow better than prose. Keep explanations close to diagrams.
- Preserve precise API semantics, lifecycle ordering, ownership rules, performance
  methodology, and execution instructions; concision must not remove required detail.
- A task changing public APIs or observable behavior must update affected contracts,
  guides, examples, and validation documentation in the same task. Include migration
  guidance for breaking changes. If no documentation update is needed, explain why.
- Jira work items must identify affected documentation and include its update in
  acceptance criteria, or provide a concrete reason no update is required.
- Keep proposals, implemented behavior, and verified results distinguishable.
- On completion, report what changed, what was verified, and any remaining limits.
