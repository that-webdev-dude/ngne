# Tooling commands and evidence

Run from the repository root with Node 24 and dependencies installed using `npm ci`:

```sh
npm test
npm run typecheck:tooling
npm run check:migration
```

`npm test` discovers engine tests in `tests/*.test.ts` and tooling regressions in
`tooling/tests/*.test.ts`. Keep entry files flat; fixtures can be nested. The Node
tooling configuration is independent of the browser/source-alias configuration.
Extend its includes when introducing additional Node modules; browser code needs
its own checked target. No public engine export changes are needed.

The migration checker reads the [planning records](../plans/tooling/README.md),
compares them with tracked and nonignored untracked surfaces, verifies the frozen
Git revision and workflow hashes, and checks the rendered ownership table. It
prints discovered/mapped/excluded counts and the number of blocked retirement
rows. A blocked retirement is expected while the old implementation remains.
A missing mapping, malformed document, stale table, changed command, unclassified
assertion or unproved deletion exits nonzero. It never edits or deletes files.

The checker needs the frozen revision in local Git history. CI fetches full
history for that reason. A shallow checkout must fetch that revision before
running the checker; a missing revision is a failure, not an exemption.

When adding a surface, review its owner and destination and update the inventory,
coverage and retirement records together. Do not erase frozen IDs. Render the
table using the exported `renderCoverage(inventory, coverage)` function, then run
Prettier and the checker. No automatic mapping-approval command is provided.

These checks establish ownership and migration gates. They do not execute the
consumer protocol, benchmarks or evidence exporter.
Existing browser and benchmark commands still own those
operations during migration. Their prerequisites and behavior remain documented
in [repository verification guidance](../README.md), [benchmarks](../benchmarks/README.md)
and [engine resource measurements](suites/benchmarks/content/README.md).

## Package preparation

```sh
npm run build:package
npm run prepare:package
npm run prepare:package -- --output out/runs/my-check
npm run check:prepared -- --manifest out/runs/my-check/evidence/manifest.json
```

`build:package` cleans only `dist/engine` before compiling the library. It rejects
linked emission directories and preserves the showcase and other outputs. Do not
run competing builds against the same checkout concurrently.

`prepare:package` builds the current package and uses the actual filename returned
by `npm pack --json --ignore-scripts`. It checks required files, hashes every packed
file, installs in a fresh directory and checks installed bytes against that inventory.
The authored engine fixture imports the public package, typechecks against its emitted
declarations, checks Node resolution, and builds at `/` and `/nested/`. Its explicit
TypeScript/Vite configs inherit no repository source aliases. This is package/build
verification; it does not execute browser lifecycle assertions.

The engine has no runtime dependencies. Preparation records a lockfile for the
selected local tarball, then installs with `npm ci --offline --ignore-scripts`,
using a run-local cache and no consumer or registry dependency. Adding runtime,
optional or peer dependencies requires an explicit dependency-policy update.
Root tooling dependencies must already be installed using the repository lockfile.
The run records Node/npm/TypeScript versions and fingerprints the root lockfile,
configuration, runner, evidence modules and existing process-cleanup implementation.

Without `--output`, each invocation creates a timestamp/UUID directory under
`out/runs`. An explicit destination must not exist, even if empty. Earlier outputs
are retained. The command prints the exact manifest path; no latest-run discovery
or fixed fallback is supported. CI prepares once, verifies that handoff, and includes
the evidence directory in its existing always-uploaded artifact tree.

## Evidence and handoff

`tooling/evidence/schema.ts` owns the shared `ngne-tooling` v1 runtime envelope,
outcome types and parsers. Every generated evidence JSON has `format`,
`documentType`, `schemaVersion` and `runId`. npm metadata and lockfiles in the
disposable working directory retain their native npm schemas.

- `manifest.json`: selection, provenance, observed OS/Node, policy, harness hashes,
  preparation state, tarball/installed/workload/dependency/build identities.
- `result.json`: stage progress and independent execution, correctness, budgets,
  cleanup and evidence outcomes; separate scenario, diagnostic and cleanup failures.
- `report.md`: projection of those records, including scope limitations.
- `artifacts.json`: evidence-relative paths, SHA-256 hashes and byte sizes; excludes
  itself. Logs, package, builds and final records are covered.
- `stages/<id>/`: command logs and optional namespaced observation/measurement
  records. Raw samples and policy remain suite-owned and are not transformed.

Manifest payload paths are relative to the run root; artifact paths are relative to
its `evidence/` directory. References use POSIX separators. Readers reject escaping
paths, links, missing/added/changed files, unsupported schemas and cross-document
run IDs. Absolute paths in command log text are diagnostics, not file references.

Initial and stage records are written atomically. Finalization attempts every
registered cleanup step using the existing process-tree verifier; failure remains
a failure even after successful checks. Final acceptance is written last, after the
report and artifact inventory. Interrupted or failed evidence publication remains
partial and cannot be reused. Required stages must complete with passing correctness;
budgets are not evaluated during preparation. An over-budget measurement may retain
complete samples and passing correctness while acceptance fails.

`verifyPrepared(manifestPath)` validates runtime schemas, required evidence,
cross-document IDs, payload hashes, the tarball, installed files, fixture inputs,
lockfiles and both builds before reuse. `copyPreparedBuild` performs the same check
before copying a selected build to a fresh disposable destination for fault injection.
Keep prepared inputs immutable. The handoff requires its original `work/` installation
and matching Node version; an archived evidence tree alone cannot resume execution.
This is integrity checking, not cryptographic authentication of a malicious author.

Failure logs and available payloads remain in the run. Working installations and
caches are not uploaded by CI. Portable export policies remain separate work;
no new browser, compatibility or performance
claim is implied by package preparation. Existing commands remain active.

## Consumer evidence and legacy fixtures

The [consumer command contract](../plans/tooling/consumer-command-contract.md)
defines the versioned tarball/hash/output interface. The validator reuses the shared
schema and checks selected identities, outcomes, exit status and retained payloads.
Use it on failed responses too, retaining the original consumer failure. The synthetic
peer and conformance tests run through `npm test`; no real consumer is selected by
these tests. Owner agreement is recorded in the contract; [pinned real integration](../docs/evidence/consumer-integration.md)
has passed. Remaining replacement and retirement gates still apply.

`npm run verify:compatibility -- --consumer <checkout> --revision <full-commit>`
explicitly selects a consumer. Checkout mode requires a clean Git root, a full
commit matching HEAD, and tracked `package.json` and `package-lock.json`. The
consumer reports every tracked file except `package-lock.json` in its source
inventory and that lockfile in its lock inventory, hashing working-tree bytes.
Ignored dependencies/build outputs are not source inputs; the consumer owns and
documents their prerequisites. Submodules and linked source files are unsupported.
There is no checkout discovery, fetch, install into the consumer workspace, or
game-specific adapter. The consumer must already implement the v1 command.

Standalone compatibility prepares the current engine package. `--manifest <exact
evidence/manifest.json>` reuses a verified preparation; `--output <new-directory>`
selects a fresh parent run outside the consumer checkout. The parent records caller
revision/changes, validator/fixture hashes, pinned consumer inputs and a separate
child run ID. `consumer/` retains the child's raw evidence; `evidence/` inventories
parent logs and observations, including the returned manifest/result/inventory.
Keep both directories and any referenced preparation when retaining the full run;
the parent evidence directory alone is not a complete consumer evidence export.

The runner invokes the exact npm contract with a ten-minute command deadline,
terminates/verifies its owned process tree, and validates every response, including
nonzero exits or missing/partial publication. Timeout does not imply cancellation;
termination and cleanup are required. It preserves command failures alongside
validation errors and rechecks consumer/package inputs after execution. Cleanup,
input drift and evidence errors fail acceptance. Ordinary commands and default CI
select only engine verification. No consumer is fetched, discovered or required.
Consumer acceptance and game measurements belong to the explicitly supplied
consumer. Synthetic runner tests do not establish real integration.

[Bounded legacy fixtures](../plans/tooling/legacy-formats.md) preserve both existing
reader families. Explicit format selection rejects unknown/new formats; existing
readers retain their strict and advisory semantics. No historical evidence is converted.

## Installed engine verification

`npm run verify:installed` prepares the current package, then runs the engine-owned
fixture at `/` and `/nested/`. It requires Chrome (`NGNE_BROWSER` or `CHROME_BIN`
can select its executable) and WebGPU. `NGNE_WEBGPU_ADAPTER=swiftshader` selects
software evidence; on Linux use the Vulkan/Xvfb prerequisites in CI. Set
`NGNE_BROWSER_HEADLESS=0` for a visible browser.

`npm run verify:installed -- --manifest <exact evidence/manifest.json>` reuses a
verified preparation. There is no latest-run lookup. Each standalone invocation owns
one fresh run directory, with package preparation under `preparation/` and browser
results under `evidence/`. The immutable preparation has its own result and artifact
inventory. The verification policy records its run ID, manifest hash and package
hash. Explicit manifest reuse keeps that preparation in its original location.
Browser mutation uses verified disposable build copies.

The readable fixture is in `tooling/fixtures/installed-engine`. Its emitted-package
declaration compilation includes API misuse checks and fixture-owned platform
instrumentation. TypeScript resolution rejects inherited configuration/source
aliases, runtime resolution checks the installed entry point, and Vite rejects
modules outside the isolated app and package. PNG and WAV resources remain external
build assets. No consumer checkout, archive or game schema is loaded.

Evidence includes assertion IDs, output RMS samples, actual device identities,
submission counts, browser version/flags and process-tree cleanup. These are
automated browser observations, not manual visual/audible approval. Asset byte
accounting is not process/driver memory. Focus is emulated for deterministic keyboard
delivery, as in the main browser harness; normal focus/background behavior still
requires manual validation. This command makes no consumer-compatibility claim.

`npm run test:installed` aliases this engine-only command. The former consumer URL
and build-directory environment options have been retired; use explicit generic
compatibility for consumer acceptance.

## Engine resource measurements

`npm run bench:engine-content -- --explore` (also `bench:content -- --explore`) prepares and installs the current
engine package and runs deterministic generated asset churn without consumer
inputs. It uses the shared installer, run lifecycle and browser session. See the
[workload procedure](suites/benchmarks/content/README.md) for sampling, ownership
checks, prerequisites, exact-manifest reuse and evidence. Measurements remain
explicit; verification does not select them. This new workload has no established
universal performance budget; headless runs are capability evidence. Named physical
profiles, explicit baseline collection, and controlled measured-budget acceptance
are described in the workload procedure. Above-budget runs retain complete sampling
and independent budget outcomes. Strict/candidate comparator work remains separate.

`npm run bench:all` uses Node orchestration for internal CPU/churn, private renderer
and repository showcase probes. Source and build inventories identify those targets;
they are distinct from installed-package measurements. Legacy flag aliases and
diagnostics remain supported. Namespaced evidence is under `out/runs/`; the
`evidence/legacy/` projection remains readable by the unchanged advisory comparator.
See [benchmark usage](../benchmarks/README.md) for retention and flag details.

## Browser sessions and protocol checks

`core/browser/session.ts` owns browser discovery, a fresh profile, the debugging
port, page/browser connections and processes it launches (including preview
servers). Register `session.stop()` before starting work so partial startup is
covered. It attempts every cleanup step, preserves process-tree records, removes
its profile, and rejects cleanup failures. `close()` returns those same records
without throwing so existing runners can combine them with their own outcomes.
External servers and run-owned static servers remain explicitly caller-owned.

Suites keep flags, navigation, assertions, warmup, sampling and budgets. Existing
browser verification, installed verification and both browser benchmark runners
use this owner. No engine exports or runtime dependencies are added. The legacy
`tests/tooling` transport/cleanup entry points remain shared compatibility seams;
there is no second benchmark CDP implementation.

The shared transport uses the extracted RFC 6455 socket in `core/browser/socket.ts`.
It checks the upgrade, receives large and fragmented UTF-8 messages, masks client
frames, and handles ping frames. Commands and one-shot event waits have deadlines;
a command timeout neither cancels nor replays it. Subscriptions return an unsubscribe
function. Connection shutdown rejects pending commands/events and has a deadline.
Diagnostics are attempted before cleanup; runners retain their original failure
when screenshots or cleanup also fail.

`npm run check:browser-transport` is an explicit real-Chrome capability check, also
required by CI. It checks byte-exact 4,260,000 and 5,242,880 byte replies, actual heap
sampling, streamed snapshots and browser tracing. `npm test` covers fragmented
wire replies and failure cases. Evidence is under a fresh `out/runs/*-browser-transport-*`
directory. These checks establish protocol capability, not performance, physical-GPU
rendering or manual audible/visual approval. Full snapshots/traces from this check
are omitted; their validated byte/node/event counts and raw sampling are retained.

The legacy browser benchmark remains headed by default. `NGNE_BROWSER_HEADLESS=1`
is an explicit capability-smoke mode and is recorded in its flags; its results
must not be substituted for visible physical-GPU performance baselines. Benchmark
artifacts are retained separately from the disposable browser profile. Failed
benchmark scenarios and cleanup retain `failure.json` with all available outcomes.
