# Benchmarks

Run everything from the repository root in PowerShell.

## Run all benchmarks

The run-all script builds both artifacts, then executes the CPU, single-texture renderer,
alternating-texture renderer, Starfall Chaos Lab and platformer workloads sequentially.

For a full run:

```powershell
npm.cmd run bench:all
```

For a short smoke test:

```powershell
npm.cmd run bench:all -- -WarmupSeconds 1 -DurationSeconds 5
```

Each invocation writes a timestamped directory under `.test-output/benchmarks/` containing a
manifest, Markdown summary, per-workload JSON, logs and browser artifacts. Keep each Chrome window
visible and unminimized. Add `-Diagnostics` to capture allocation profiles for game workloads plus
heap snapshots and browser traces; diagnostics perturb timings and are disabled by default.

Use `-SkipBuild` only when both `dist/` and `dist-browser/` are already current.

## Compare two runs

Generate a scan-first Markdown report and machine-readable JSON by passing the baseline directory
first and the candidate directory second:

```powershell
npm.cmd run bench:compare -- `
    .test-output\benchmarks\<baseline-run> `
    .test-output\benchmarks\<candidate-run>
```

The comparison is written under `.test-output/comparisons/`. It surfaces definite errors and
environment mismatches before listing timing, long-frame, dropped-tick, retained-heap and allocation
changes by workload. Changes of 10% or more are highlighted by default; this is an attention signal,
not an automatic pass or failure. Override it with `--attention-percent`, or select an output folder
with `--output`.

## 1. CPU benchmarks

```powershell
npm.cmd run bench
```

This runs the CPU benchmark suite directly—no browser or server required.

Expect JSON containing:

- `ecs`: traversal of 20,000 entities.
- `chaos`: simulation and render preparation for the stress arena.
- `collisionGrid`: schema-view spatial lookup cost.
- `epochTraversal`: commit and first/second traversal costs.
- Environment and Git revision.
- Min, mean, p50, p90, p95, p99, and max timings.

Important:

- `collisionGrid.valid` should be `true`.
- `chaos.ticksOverBudget` reports samples exceeding a 60 Hz CPU budget.
- These are CPU measurements, not browser FPS or GPU timings.
- Runtime is roughly a few seconds.

## 2. Build the browser benchmark

```powershell
npm.cmd run build:browser
```

Expect the output to include:

```text
dist-browser/benchmarks/browser/index.html
dist-browser/validation.html
```

The benchmark page is deliberately absent from the normal production `dist/`.

## 3. Run the WebGPU renderer benchmark

Copy and run this block:

```powershell
$env:NGNE_URL = 'http://127.0.0.1:4173/benchmarks/browser/index.html?workload=renderer-webgpu'
$env:NGNE_SERVE_DIR = (Get-Location).Path
$env:NGNE_SERVE_OUT_DIR = 'dist-browser'
$env:NGNE_EXPECTED_BACKEND = 'webgpu'
$env:NGNE_WARMUP_SECONDS = '10'
$env:NGNE_DURATION_SECONDS = '60'

npm.cmd exec -- tsx benchmarks/browser/browser-baseline.ts
```

The harness will:

1. Start a Vite preview server.
2. Open a fresh, visible Chrome window.
3. Verify that the served files match `dist-browser`.
4. Reject software or fallback WebGPU adapters.
5. Warm up for 10 seconds.
6. Sample for 60 seconds.
7. Capture allocation data.
8. Close the browser and preview server.
9. Print a JSON report.

Keep the Chrome tab visible and unminimized throughout the run. Hidden tabs throttle `requestAnimationFrame`.

## 4. Expected renderer results

For the default single-texture workload, expect:

- `workload`: fixed 10,000-sprite renderer fixture.
- `metadata.mode`: `webgpu`.
- `metadata.sprites`: `10000`.
- `metadata.visibility`: `visible`.
- `metadata.adapter.isFallbackAdapter`: `false`.
- `metrics.drawCalls`: normally `1`.
- `metrics.uploadBytes`: `560048`.
- `rendererEvidence.error`: empty.
- `pageError`: empty.
- `cpuPreparationMs`, `cpuSubmissionMs`, and `cpuTotalMs` percentiles.
- A populated allocation profile.
- `survivingOwnedProcesses`: empty.

The renderer timings cover CPU preparation and submission only. They do not wait for GPU completion.

Frame intervals may be around 16.7 ms on a 60 Hz display, but refresh rate, browser state, hardware, and background activity can change this. There are no universal pass/fail timing thresholds.

## 5. Alternating-texture workload

This stresses texture-run batching. Change only the URL:

```powershell
$env:NGNE_URL = 'http://127.0.0.1:4173/benchmarks/browser/index.html?workload=renderer-webgpu&alternating=1'

npm.cmd exec -- tsx benchmarks/browser/browser-baseline.ts
```

Expect `metadata.alternating` to be `true` and draw-call behavior to differ substantially from the single-texture workload.

## 6. Preserve artifacts

By default, allocation profiles are written to a fresh temporary Chrome-profile directory. To keep them somewhere predictable:

```powershell
$env:NGNE_ARTIFACT_DIR = Join-Path (Get-Location) '.test-output\benchmarks\renderer-webgpu'
```

Then run the baseline command. The report will include the artifact paths and SHA-256 hashes.

Optional evidence:

```powershell
$env:NGNE_SNAPSHOTS = '1'
$env:NGNE_TRACE = '1'
$env:NGNE_RETAINED_EVERY_SECONDS = '10'
```

This adds heap snapshots, a Chrome trace, and forced-GC retained-heap checkpoints. It makes the run slower and can perturb timings, so use it for diagnostics rather than clean timing comparisons.

## 7. Game baselines

Build the normal application:

```powershell
npm.cmd run build
```

### Starfall Chaos Lab

```powershell
$env:NGNE_URL = 'http://127.0.0.1:4173/'
$env:NGNE_SERVE_DIR = (Get-Location).Path
$env:NGNE_SERVE_OUT_DIR = 'dist'
$env:NGNE_EXPECTED_BACKEND = 'webgpu'
$env:NGNE_WARMUP_SECONDS = '10'
$env:NGNE_DURATION_SECONDS = '60'

npm.cmd exec -- tsx benchmarks/browser/browser-baseline.ts
```

The harness launches Chaos Lab automatically.

### Platformer

```powershell
$env:NGNE_URL = 'http://127.0.0.1:4173/examples/platformer/?baseline'

npm.cmd exec -- tsx benchmarks/browser/browser-baseline.ts
```

Expect frame intervals, callback CPU time, heap activity, long tasks, FPS telemetry, sprite counts, and dropped-tick telemetry.

## 8. Compare results correctly

For meaningful comparisons:

- Use the same machine, power mode, browser version, viewport, and backend.
- Close unrelated CPU/GPU-heavy applications.
- Run each condition several times.
- Compare p50 and p95/p99, not only the mean.
- Keep workload metadata and environment details with the result.
- Treat heap growth from one short run as a signal to investigate, not proof of a leak.
- Do not compare renderer CPU submission numbers as if they were GPU execution time.

## 9. Clear PowerShell settings

Afterward:

```powershell
'NGNE_URL',
'NGNE_SERVE_DIR',
'NGNE_SERVE_OUT_DIR',
'NGNE_EXPECTED_BACKEND',
'NGNE_WARMUP_SECONDS',
'NGNE_DURATION_SECONDS',
'NGNE_ARTIFACT_DIR',
'NGNE_SNAPSHOTS',
'NGNE_TRACE',
'NGNE_RETAINED_EVERY_SECONDS' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
```
