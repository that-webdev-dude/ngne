# Tooling guide v02

Detailed prerequisites and evidence rules are in the [tooling reference](README.md).

## Before starting

Run from the NGNE repository root in Windows PowerShell, with Node 24 or newer. Install dependencies with `npm.cmd ci` if needed. Browser checks require Chrome. Run commands sequentially; do not run competing builds in this checkout.

Replace `<placeholders>` with actual values, without angle brackets. In npm commands, `--` forwards the remaining arguments to the script.

## What runs against what?

| Check                          | Target                                          | Purpose                                                 |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------- |
| Everyday checks                | Repository source                               | Catch type, test, formatting and build errors           |
| `check:prepared`               | A saved package preparation                     | Check that its files and recorded identities are intact |
| `verify:installed`             | The generated, installed package                | Check its test app in Chrome                            |
| `test:browser`                 | A browser test app built from repository source | Check engine integration in Chrome                      |
| `bench:all -- -Workload churn` | Engine source, directly in Node.js              | Measure entity creation/removal cost                    |
| `verify:compatibility`         | A separate game using the selected package      | Check whether that game's verification still passes     |

## Stage 1: Everyday checks

```powershell
npm.cmd run typecheck
npm.cmd run typecheck:tooling
npm.cmd test
npm.cmd run format:check
npm.cmd run build
```

These check engine types, tooling/benchmark types, regression tests, formatting, then type/API checks and the production build. Successful builds write the engine to `dist/engine/` and the site to `dist/`.

`format:check` only reports problems. `npm.cmd run format` rewrites files across the configured directories; review its changes.

### Comprehensive engine verification

```powershell
$env:NGNE_WEBGPU_ADAPTER = "swiftshader"
npm.cmd run verify:engine
```

This runs 12 existing stages: formatting, tests, tooling types, tooling migration validation, engine types, production build, browser-test build, package preparation, preparation integrity, browser transport, installed-package browser checks, and repository browser tests.

It stops at the first required failure. Results go under `out/runs/*-verification-*/`; success means `accepted: true` in `evidence/result.json`. Benchmarks and separate-game compatibility are not included. See stage 3 for the limits of software browser checks.

## Stage 2: Package preparation

A package is what another game installs: compiled engine JavaScript, TypeScript declarations, public exports, documentation and standard package metadata. It excludes repository tooling, tests, benchmarks and demos.

Generate one to check distribution works or to try an engine update in another game. This does not publish anything to npm.

```powershell
npm.cmd run prepare:package
```

The command builds the engine, creates an npm `.tgz`, installs it in isolation, validates installed files/types, and builds a **fixture**: a small test app using the installed engine. It does not run that app in a browser yet.

### Generated files

The command prints a preparation path under `out/runs/`:

| Path inside that run                | Purpose                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `evidence/package/ngne-0.1.0.tgz`   | The package another game installs                             |
| `evidence/builds/root/`, `nested/`  | Fixture builds for two URL locations                          |
| `evidence/report.md`, `result.json` | Readable and machine-readable outcomes                        |
| `evidence/manifest.json`            | Identifies this exact preparation, its inputs and environment |
| `evidence/artifacts.json`           | Output-file inventory                                         |
| `evidence/stages/`                  | Per-step logs and outputs                                     |
| `work/installation/`                | Isolated test app, installed engine and dependencies          |
| `work/dependencies/`, `work/cache/` | Dependency manifests/lockfile and npm cache/logs              |

To use the package, run this **from the separate game's directory**:

```powershell
npm.cmd install "C:\path\to\ngne-0.1.0.tgz"
```

The game imports public exports from `ngne`. It only needs the `.tgz`, not the rest of the preparation. Install a newly generated `.tgz` to try a later engine build.

### Reuse a preparation

Save the printed `evidence/manifest.json` path. **A manifest is not a package version**: two different engine builds can both be called `ngne@0.1.0`. The manifest and recorded hashes identify the exact preparation.

```powershell
npm.cmd run check:prepared -- --manifest "<manifest>"
```

This checks identities, hashes, installed files and fixture builds without rebuilding or launching a browser. Success means the saved preparation is intact.

Keep the complete preparation directory, including `work/`, and use the same Node version when reusing it. The manifest alone is insufficient. Prepare again after engine changes to test a new package.

## Stage 3: Browser verification

Builds and Node tests cannot establish browser behavior. Browser checks exercise rendering, asset loading and engine lifecycle behavior in Chrome.

### Generated package

```powershell
$env:NGNE_WEBGPU_ADAPTER = "swiftshader"
npm.cmd run verify:installed -- --manifest "<manifest>"
```

Unlike `check:prepared`, this executes the installed-package fixture in Chrome. It serves the app at two temporary local URLs:

- `/`: website root, such as `http://localhost:PORT/`.
- `/nested/`: a subdirectory, such as `http://localhost:PORT/nested/`.

Testing both catches asset paths that work at the root but break under a subdirectory. Their built files are in the preparation's `evidence/builds/`; the server runs during verification.

Results go into a new `out/runs/` directory. Read `evidence/report.md`; success requires root/nested checks, complete evidence, process cleanup and `accepted: true` in `evidence/result.json`. Performance budgets are not evaluated.

### Repository source

```powershell
npm.cmd run build:browser
npm.cmd run test:browser
```

These do **not** use the generated package. They build the repository's browser test app into `dist-browser/`, then run integration checks including game launch/pause/resume. Results go to `.test-output/browser/`; success means zero failed checks and successful process cleanup.

`swiftshader` selects software WebGPU. These passes establish automated correctness in that environment, not physical GPU performance or manual visual/audio approval. Hardware-backed execution is reported as unsupported with SwiftShader, regardless of assertion names.

The setting stays active in this terminal. Keep it for stage 5, or clear it when finished:

```powershell
Remove-Item Env:NGNE_WEBGPU_ADAPTER
```

## Stage 4: Benchmarks

```powershell
npm.cmd run bench:all -- -Workload churn
```

This is a **synthetic workload, not a game**. It runs engine source directly in Node.js: keep 10,000 entities alive, repeatedly replace 1,000, and time component authoring, queued despawns/spawns and `World.commit()` per batch. It uses 100 warmup batches followed by 1,000 measured batches.

This selection skips builds and browsers. It does not use the generated package, rendering or GPU; SwiftShader has no effect.

### Read the results

Each run creates a directory under `out/runs/`:

| File                                      | What to read                                                          |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `evidence/report.md`                      | Run acceptance and cleanup, not timing statistics                     |
| `evidence/stages/churn/measurements.json` | `raw.batchMs` for statistics; `raw.rawBatchMs` for individual samples |
| `evidence/legacy/analysis.json`           | Consolidated measurements in the format used by `bench:compare`       |

`legacy/` contains **this run's data in the older output format**, not old results. It keeps the existing comparator working; its other files hold metadata, a brief summary and workload logs/results.

| Metric       | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| Median (p50) | Half the batches took this long or less                    |
| p95 / p99    | About 95% / 99% finished within this time                  |
| Maximum      | Duration of the slowest batch; no explanation of its cause |
| Mean         | Average batch duration                                     |

Times are milliseconds per batch, not game FPS or GPU time. `accepted: true` means the measurement run succeeded; `budgets: not evaluated` means no speed target was checked.

### Compare two runs

Run the same benchmark again, then pass **baseline first, candidate second**:

```powershell
npm.cmd run bench:compare -- "out/runs/<baseline-run>/evidence/legacy" "out/runs/<candidate-run>/evidence/legacy"
```

This reads saved results; it does not rerun benchmarks. Reports are written under `.test-output/comparisons/` as `report.md` and `comparison.json`.

**Unchanged code can produce different timings.** Background activity, CPU clocks/temperature, garbage collection and runtime optimisation can affect results. `REVIEW REGRESSIONS` flags slowdowns crossing the default 10% attention threshold; it is not proof that code caused a regression.

Repeat runs with the same machine, power mode, runtime and workload. Look for a consistent slowdown; p99 and maximum are especially sensitive to occasional delays. The comparator can exit zero despite warnings or detected problems, so read its report. See [comparison guidance](suites/benchmarks/README.md#compare).

## Stage 5: Consumer compatibility

A **consumer** is a separate game that uses NGNE. Run this before adopting or releasing an engine update to check whether a fixed game revision still passes its verification with the selected package. It covers the checks that game implements, not every possible gameplay behavior.

Unlike `verify:installed`, which uses NGNE's own fixture, this invokes the separate game's verification command. It works only with consumers implementing the [verification interface](README.md#consumer-evidence-and-legacy-fixtures), not arbitrary game folders. The checkout must be clean and committed, with its documented prerequisites ready.

Example for the platformer, run from the **NGNE repository root**:

```powershell
$env:NGNE_WEBGPU_ADAPTER = "swiftshader"
$consumer = "C:\Users\jfabi\Documents\Projects\tests\ngne-platformer"
$revision = git -C $consumer rev-parse HEAD

npm.cmd run verify:compatibility -- `
  --consumer "$consumer" `
  --revision $revision `
  --manifest "<manifest>"
```

- `--consumer`: the separate game's checkout.
- `--revision`: its full source commit, matching HEAD.
- `--manifest`: the exact engine preparation from stage 2, not a version number.

Results go into a new compatibility run under `out/runs/`. Its `evidence/report.md` and `evidence/result.json` record acceptance; `consumer/` retains the game's own evidence. Success requires the checks, evidence validation and cleanup to pass, with `accepted: true`.

Keep both directories and the referenced preparation when retaining the full run. A pass applies to that game revision, package and recorded environment; it does not establish performance budgets or manual visual/audio approval.
