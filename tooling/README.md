# Tooling commands and evidence

Run from the repository root with Node 24 and dependencies installed using `npm ci`:

```sh
npm test
npm run typecheck:tooling
```

`npm test` discovers engine tests in `tests/*.test.ts`, demo tests in
`demo/tests/*.test.ts`, example tests in `examples/*/tests/*.test.ts`, and tooling
regressions in `tooling/tests/*.test.ts`. Keep entry files flat; fixtures can be nested.
The browser validation entry is `suites/verification/browser/validation.ts`; it
composes engine and consumer checks from their owning directories. The Node
tooling configuration is independent of the browser/source-alias configuration.
Extend its includes when introducing additional Node modules; browser code needs
its own checked target. No public engine export changes are needed.

Browser and benchmark prerequisites are documented in
[repository verification guidance](../README.md), [benchmarks](suites/benchmarks/README.md)
and [engine resource measurements](suites/benchmarks/content/README.md).

## Local engine verification

`npm run verify:engine` runs, in order: formatting, all unit/tooling tests,
tooling typechecks, root typecheck, the production build,
the browser build, one package preparation, exact-manifest validation, browser
transport/profiler capability, installed root/nested verification using that same
manifest, and browser integration. Individual commands remain usable. Benchmarks
and consumer compatibility are separate explicit commands.

Install Chrome and the browser prerequisites described below. On Windows use
`npm.cmd`; for software GPU verification set `NGNE_WEBGPU_ADAPTER=swiftshader`.
On Linux, Chrome needs Vulkan support for SwiftShader and Xvfb for headed execution.
Set `NGNE_BROWSER_HEADLESS=0`
and run the command under `xvfb-run -a`. Do not run competing builds in this checkout.

Each invocation creates a fresh `out/runs/*-verification-*` directory. It retains
stage command logs, aggregate outcomes and browser integration artifacts; package
evidence is under `preparation/evidence/`. Installed and transport commands print
their separate fresh evidence paths into the corresponding stage logs. Required
command failures stop composition and fail aggregate acceptance; the existing
process owner verifies cleanup before final publication. Existing command
deadlines and acceptance rules remain in effect. This command makes no benchmark,
consumer, physical-GPU or manual visual/audible claim.

## Package preparation

```sh
npm run build:package
npm run prepare:package
npm run prepare:package -- --output out/runs/my-check
npm run check:prepared -- --manifest out/runs/my-check/evidence/manifest.json
```

`build:package` cleans only `dist/engine` and `dist/preview` before compiling the
library and preview tool. It rejects linked emission directories and preserves other outputs. Do not
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
or fixed fallback is supported. `verify:engine` prepares once and reuses that exact
manifest for validation and installed verification.

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

Failure logs and available payloads remain in the run. An evidence-only archive
excludes the working installation and cannot resume preparation. Package preparation
does not establish browser, compatibility or performance acceptance.

## Consumer evidence

The [consumer command validator](evidence/consumer-contract-v1.ts)
defines the versioned tarball/hash/output interface. The validator reuses the shared
schema and checks selected identities, outcomes, exit status and retained payloads.
Use it on failed responses too, retaining the original consumer failure. The synthetic
peer and conformance tests run through `npm test`; no real consumer is selected by
these tests.

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
input drift and evidence errors fail acceptance. `verify:engine` selects only
engine verification. No consumer is fetched, discovered or required.
Consumer acceptance and game measurements belong to the explicitly supplied
consumer. Synthetic runner tests do not establish real integration.

Historical reader fixtures preserve the existing strict and advisory semantics.
Unknown formats are rejected; historical evidence is not converted.

### Adopting the consumer command

Start with [the executable reference](consumer/verify-engine.ts). It uses the
existing [v1 validator](evidence/consumer-contract-v1.ts) and
[evidence schema](evidence/schema.ts); the synthetic contract peer is not an
installation example. Copy these files into the consumer, preserving their paths
beneath a consumer-owned directory such as `verification/`:

```text
consumer/verify-engine.ts
core/cleanup.mjs
core/cleanup.d.mts
evidence/identity.ts
evidence/schema.ts
```

Copy NGNE's `LICENSE` alongside them. These are vendored source files: no sibling
checkout imports or published tooling dependency are needed. Add
`"verify:engine": "node verification/consumer/verify-engine.ts"` to the consumer's
npm scripts. Node 24 runs the reference's erasable TypeScript directly; include
`verification/**/*.ts` in a Node typecheck with `allowImportingTsExtensions: true`.

Edit the reference's `checks`, `dependencySection`, `candidateDirectory`,
`configureCandidate` and `omissions` for the game. Defaults select typecheck,
tests, build and package checks. Each selected script must exist and test the
installed public package. Keep acceptance assertions in those consumer-owned
checks. The reference supports a single npm package with a tracked lockfile;
workspace layouts and required install scripts need consumer-specific adaptation.

The five v1 flags remain unchanged. Run through npm so `npm_execpath` identifies
the npm CLI. Prerequisites are Git, Node 24, npm, `tar` and an npm cache containing
the consumer's locked dependencies for the current OS. Install dependencies once
using the consumer's normal setup before selecting its clean, committed checkout.
The isolated run uses that cache with `--offline --ignore-scripts`; cache misses
fail with retained logs rather than silently fetching or running install hooks.
Windows process cleanup also requires PowerShell/CIM and `taskkill` permissions.

The reference copies tracked inputs into fresh `work/app` outside the checkout,
retains the caller's actual tarball filename/hash, updates only the copied package
and lock, installs with `npm ci`, and compares every installed package file with
the supplied archive. Original source/lock identities and revision are recorded
separately from the isolated package/lock hashes. The original vendor archive and
historical engine record remain source inputs, even when the candidate has a
different version or filename. Do not identify a candidate by the old vendor name.

For a vendor-based game, choose a new location such as `vendor/.candidate` and
teach its package check to use `.ngne-candidate.json` only inside the isolated
copy: check the dependency against the record's actual filename, compare archive
SHA-256 and installed version, and retain the ordinary baseline check otherwise.
Do not overwrite or relabel the historical engine record with the candidate's
identity. Candidate version and filename are independent; prerelease or renamed
archives must not be rejected by a numeric-only vendor filename convention.

Commands have a two-minute deadline each, beneath the parent's ten-minute limit.
Every process tree is stopped and verified before evidence finalization, including
failed checks. Original checkout/tarball and installed bytes are rechecked after
cleanup on both success and failure. Check, cleanup, integrity and publication
failures cannot produce acceptance. Failures before installation may leave
partial/nonconforming evidence; the parent retains and rejects that response.

Browser checks are optional consumer scripts. If selected, use a fresh browser
profile and disposable build/storage, register process cleanup before startup,
retain observations under `evidence/stages/`, and record actual browser/GPU
identity and remaining omissions. Ordinary profiles and saved games must remain
untouched. Default reference checks establish no browser, audible, device or
performance acceptance.

Prepare once with `npm run prepare:package`, then use the exact printed manifest:

```sh
npm run verify:compatibility -- --consumer <checkout> --revision <full-commit> --manifest <exact-manifest> --output <new-directory>
```

Prove adoption with one real consumer and a second fresh run whose consumer-owned
check deliberately fails only in its isolated copy. Confirm nonzero acceptance,
the original failing stage/log, before/after input identities and process cleanup.
Record the committed adapter revision, candidate identity, customization and any
recipe gaps. Keep parent `evidence/`, child `consumer/` (including its `work/` for
rebuilding diagnostics), and the referenced preparation. Passing synthetic tests
alone does not close a real adoption gap. Engine-only verification remains independent.

## Installed engine verification

### Sprite inspection

The installed `ngne-preview` command and adapter format are documented in the
[engine guide](../docs/guide.md#sprite-and-animation-inspection). Its source lives
in `preview/`; fixtures and regression tests live in `fixtures/preview/` and
`tests/preview.test.ts`. No consumer checkout is required by ordinary tests.

After package preparation, run
`npm run verify:preview -- --manifest <exact evidence/manifest.json>`.
This uses the shared run, integrity and process/browser owners with a fresh isolated
installation and headless Chrome/SwiftShader. It checks installed engine bytes,
stepping, bounded viewport/panning and zoom-center retention, CSS magnification
(including lost-detail pixel comparisons), playback,
diagnostics and cleanup. `--fixture <isolated-input-directory>` selects an external
snapshot containing `preview.config.mjs` and its local images/metadata; the runner
copies it into a fresh installation. External fixtures must provide an animation
with multiple entries for playback verification. Art and motion approval requires
separate human observations; software browser checks do not establish device appearance.

### Engine lifecycle

`npm run verify:installed` prepares the current package, then runs the engine-owned
fixture at `/` and `/nested/`. It requires Chrome (`NGNE_BROWSER` or `CHROME_BIN`
can select its executable) and WebGPU. `NGNE_WEBGPU_ADAPTER=swiftshader` selects
software evidence; on Linux, Chrome needs Vulkan support and headed execution needs
Xvfb or a display server. Set
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
and independent budget outcomes. New installed-resource cross-revision comparison
is unsupported.

`npm run bench:all` uses Node orchestration for internal CPU/churn, private renderer
and repository showcase probes. Source and build inventories identify those targets;
they are distinct from installed-package measurements. Existing flag aliases and
diagnostics remain supported. Each run writes one canonical evidence tree under
`out/runs/`, with one measurement document per workload.
See [benchmark usage](suites/benchmarks/README.md) for retention and flag details.

## Benchmark comparisons

`npm run bench:compare -- <baseline-run-directory> <candidate-run-directory>` invokes
[the comparison command](commands/compare-benchmarks.ts). Supply run directories directly;
`evidence/` directories are also accepted. Current-format reading checks document versions,
run identities, final outcomes, artifact sizes/hashes and workload data. Historical
per-stage, consolidated and compact output directories remain readable without conversion.
New runs never produce a compatibility copy. Full and compact runs use the same measurements.
Reports remain JSON/Markdown under `.test-output/comparisons/` by default;
`--output` selects another directory and `--attention-percent` changes the default
10% attention threshold. A completed advisory scan exits zero even when it finds
problems; invalid arguments or unreadable/invalid input exit one. A comparison does
not establish controlled performance acceptance.

`node tooling/evidence/compare-content.mjs <baseline-directory> <candidate-directory>`
invokes the strict retained-content comparator. It preserves exact identity,
passed acceptance and cleanup requirements, returning exit two for incompatibility.
Its historical input family and JSON output are unchanged; new installed-resource
cross-revision comparison remains unsupported.

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
use this owner. No engine exports or runtime dependencies are added. The shared
`core/browser/devtools.mjs` transport and `core/cleanup.mjs` cleanup helpers are shared;
there is no second benchmark CDP implementation.

The shared transport uses the extracted RFC 6455 socket in `core/browser/socket.ts`.
It checks the upgrade, receives large and fragmented UTF-8 messages, masks client
frames, and handles ping frames. Commands and one-shot event waits have deadlines;
a command timeout neither cancels nor replays it. Subscriptions return an unsubscribe
function. Connection shutdown rejects pending commands/events and has a deadline.
Diagnostics are attempted before cleanup; runners retain their original failure
when screenshots or cleanup also fail.

`npm run check:browser-transport` is a real-Chrome capability check included in
`verify:engine`. It checks byte-exact 4,260,000 and 5,242,880 byte replies, actual heap
sampling, streamed snapshots and browser tracing. `npm test` covers fragmented
wire replies and failure cases. Evidence is under a fresh `out/runs/*-browser-transport-*`
directory. These checks establish protocol capability, not performance, physical-GPU
rendering or manual audible/visual approval. Full snapshots/traces from this check
are omitted; their validated byte/node/event counts and raw sampling are retained.

The browser benchmark remains headed by default. `NGNE_BROWSER_HEADLESS=1`
is an explicit capability-smoke mode and is recorded in its flags; its results
must not be substituted for visible physical-GPU performance baselines. Benchmark
artifacts are retained separately from the disposable browser profile. Failed
benchmark scenarios and cleanup retain `failure.json` with all available outcomes.
