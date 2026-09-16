# NGNE verification

## NGNE-13 — 16 September 2026

The browser integration job builds `dist-browser/` separately from the deployable `dist/`, serves it
with a bounded Vite preview, verifies that the served validation entry matches that build, and drives
Chrome through the DevTools protocol. GitHub uses headed Chrome on a bounded Xvfb display so the
software WebGPU canvas exercises the presentation path as well as offscreen readback. The harness
writes `.test-output/browser/results.json` plus browser/process logs, captures a PNG on failure, and
terminates the preview, browser and fresh profile. Its GitHub job summary lists passed assertions,
skipped-as-unsupported assertions and failures separately.

CI installs the Vulkan/Mesa and Xvfb runtime packages, then runs Chrome with Dawn's SwiftShader
adapter. This executes WebGPU commands, presentation and readbacks in software; it is not
physical-GPU, driver, display-timing or cross-browser evidence. The result records
adapter details and marks hardware-backed evidence as skipped rather than passed. GitHub's Ubuntu
runner image supplies Chrome, while Chromium requires unsafe WebGPU to permit its fallback adapter;
see the [runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
and [Chromium adapter gate](https://chromium.googlesource.com/chromium/src/+/lkgr/gpu/command_buffer/service/webgpu_decoder_impl.cc).

Reproduce after `npm ci`:

```sh
npm run build
npm run build:browser
NGNE_WEBGPU_ADAPTER=swiftshader npm run test:browser
```

On Windows PowerShell, set `$env:NGNE_WEBGPU_ADAPTER = "swiftshader"` before the last command. Omit
the variable to use Chrome's default adapter for local hardware evidence. `NGNE_BROWSER` selects a
specific Chromium executable.

Local software-WebGPU run on Windows 11, Chrome 152: 160 passed, one skipped-as-unsupported
(hardware-backed execution), zero failed. Coverage includes exact pixels and ordering, decoded image
upload, 10,000-sprite buffer growth/reuse, backing resize, controlled loss/recovery, disposal and late
callbacks, plus built Starfall and platformer launch/pause/resume paths. A separate
`NGNE_BROWSER_INJECT_FAILURE=1` run exited nonzero on `intentional CI assertion failure`; the ordinary
run then passed. This is local workflow reproduction, not a completed GitHub-hosted workflow run.

## NGNE-12 — 14 September 2026

Session 1 (measurement and diagnosis) of the approved [plan](../plans/NGNE-12-measurement.md)
(SHA256 `279a8e7eeedcb8a7e438c90a108e7f6386808147a85497a834b357263b0caf9b`,
[review log](../plans/NGNE-12-review-log.md) round 4). Phase 0 (entry, exports and definitions) is
recorded below. Every definition was written before any timed run; phase 0 contains no timed data.

### Entry and revisions (phase 0)

- Plan SHA256 matches the review log. HEAD `86494fd2bcdea81bc48dc9b7fe7d0b0efb942947`;
  `git status --porcelain` lists only the plan and its review log. Jira NGNE-12 re-read (updated
  14 September 2026): no material change; the plan's RS revision refines Jira's R0/R1/R2 split.
  `codex --version`: codex-cli 0.154.0.
- Exports: fresh `git archive` of each revision with `EXPORT_REVISION`; `npm ci` and `npm run build`
  exit 0 in all four. The NGNE-27 exports were not reused.

| Id  | Revision                                   | `dist/` files | SHA256 of the `dist/` asset list (`manifests/dist-<rev>.sha256`)   |
| --- | ------------------------------------------ | ------------: | ------------------------------------------------------------------ |
| R0  | `a906f3a47990c0c2f7007994b1ecf8c14e9280ee` |            28 | `eece56e5889fda70e779a1138f031a6d71e12aa81167581326c59636c7d34489` |
| RS  | `9c00f023bfeaa2fb34034a710e0f4746005b511a` |            28 | `e76da760858c9071291582f8d97e3013861554efa9a09e5734fc76d25fe3c17a` |
| R1  | `12b727e7f095a3ddd763724190a9d12ace6d2d76` |            46 | `3d27022e6d6384611b412cc0aea72c46cb94e794cb8c015b9eaa338665ccc48b` |
| R2  | `86494fd2bcdea81bc48dc9b7fe7d0b0efb942947` |            46 | `0e1e5add9c3aa967064881e8898bad67797bae7ebbcdf091eb54668c720865ed` |

All four contain Starfall, the platformer, `tests/benchmark.ts` and `tests/browser-baseline.ts`; the
renderer fixture exists at R1 and R2 only. `vite.config.ts` is identical in all four.

### Environment

- Windows 11 Home 10.0.26200 x64; 12th Gen Intel Core i7-12650H, 10 cores / 16 logical; 15.7 GiB;
  Node v24.15.0, npm 11.12.1; headful Chrome 152.0.7977.84; DPR 1; localhost.
- Power: Balanced plan (`381b4222-…`), on AC (battery status 2, 97%).
- GPUs present: Intel UHD Graphics (driver 31.0.101.4314) and NVIDIA GeForce RTX 4060 Laptop
  (32.0.15.6614). Chrome uses the Intel GPU: WebGPU adapter `intel` / `gen-12lp`,
  `isFallbackAdapter: false`, empty device and description; WebGL renderer
  `ANGLE (Intel, Intel(R) UHD Graphics (0x000046A3) Direct3D11 vs_5_0 ps_5_0, D3D11)`.
- Adapter features: `bgra8unorm-storage`, `clip-distances`, `core-features-and-limits`,
  `depth-clip-control`, `depth32float-stencil8`, `dual-source-blending`, `float32-blendable`,
  `float32-filterable`, `indirect-first-instance`, `primitive-index`, `rg11b10ufloat-renderable`,
  `shader-f16`, `subgroup-size-control`, `subgroups`, `texture-component-swizzle`,
  `texture-compression-bc`, `texture-compression-bc-sliced-3d`, `texture-formats-tier1`,
  `texture-formats-tier2`, **`timestamp-query`**. The engine requests no features, so GPU execution
  time stays a required evidence gap (plan it in session 2 or waive it in phase 5).

### Provenance

- Raw results live outside the checkout in `C:/Users/jfabi/AppData/Local/Temp/ngne-12-diagnostics/`
  (local evidence, not portable). `scripts/manifest.sh` (SHA256 prefix `5f1f9be56a2e`) writes each
  `<result>.manifest.txt` sidecar with the plan's fields.
- NGNE-27 scripts verified and copied unchanged: `chaos-only.ts` `66e2e84bbfc1`, `parity-probe.ts`
  `73e3f5de606e`, `profile-summary.mjs` `b893edc25e06`.
- Source maps: `vite build --sourcemap hidden --outDir dist-hiddenmap` in each export produced the same
  8 page files with byte-identical JavaScript, HTML and CSS (0 differences in all four). Allocation
  sites are therefore source-mapped through `dist-hiddenmap/*.map`; the served files are byte-identical
  to that build.
- Heap snapshots name classes by minified identifiers. `scripts/class-map.mjs` (`5de838f8d13d`) maps
  every minified class in each bundle to a single source name (no ambiguous entries), in
  `definitions/class-map-<rev>.json`.
- Provenance gap (untimed probes only): `scripts/phase0-preview.mts` was edited twice during phase 0
  (preview readiness accepts any HTTP status, required by the fixture build without `index.html`; trace
  stream parsed from `traceEvents`). The cycle runs used the first version and the fixture and trace
  runs the second. Earlier hashes were not recorded; sidecars carry the final `847b5ee1501c`. The
  in-probe trace summary reported 0 events; alignment below comes from `scripts/trace-align.mjs`
  (`407a5d11b717`) over the saved traces.

### Attributable windows

`parity-probe.ts` ran in every export (two runs each, `parity/<mode>-<rev>.json`). All eight results
are deterministic across their two runs.

| Workload                     | R0, RS, R1 hash list | R2 hash list    | Terminal R0, RS, R1           | Terminal R2              | Order window (all) |
| ---------------------------- | -------------------- | --------------- | ----------------------------- | ------------------------ | ------------------ |
| Starfall Chaos, 900 ticks    | `05819083…8510`      | `969b0e59…c4e9` | `playing`, score 274,800      | `playing`, score 280,400 | 210                |
| Starfall normal, 2,182 ticks | `19229bf9…7c67`      | `19229bf9…7c67` | `dead` at 2,182, score 55,350 | identical                | 2,182              |

Window rule: longest tick prefix with identical hash lists.

| Pair                | Chaos `W`                                       | Starfall normal `W` |
| ------------------- | ----------------------------------------------- | ------------------- |
| R0→RS, RS→R1, R0→R1 | 900 (whole run identical)                       | 2,182 (whole run)   |
| R0→R2, RS→R2, R1→R2 | 237 (ticks 0–237 identical; first mismatch 238) | 2,182 (whole run)   |

- `chaos-split.ts` keeps the `chaos-only.ts` rule (sample `i` in the window when `101 ≤ i` and
  `i + 1 ≤ W`): 136 samples (101–236) for `W` = 237; 799 samples for `W` = 900.
- Profiling runs use `--profile-window` 237 and 900.
- NGNE-27 used `W` = 210, its 512-row order window; the plan's identical-prefix rule gives 237. The
  order window is still 210 in every export.

### Structural churn equivalence

Two standalone fresh-process scripts; only the component definitions differ.

| Parameter        | `churn-object.ts` (R0, RS, R1)                                                                                                                                                                                                                                     | `churn-schema.ts` (RS, R1, R2)                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Import           | `World` from `src/ecs.ts`, `component` from `src/index.ts`                                                                                                                                                                                                         | Same, plus `f64`                                                                                        |
| Components       | `position` `() => ({ x: 0, y: 0 })`, `velocity` `() => ({ x: 0, y: 0 })`, `lifetime` `() => ({ ticks: 0 })`                                                                                                                                                        | `position` `{ x: f64(), y: f64() }`, `velocity` `{ x: f64(), y: f64() }`, `lifetime` `{ ticks: f64() }` |
| Compositions     | A = position + velocity; B = position + velocity + lifetime                                                                                                                                                                                                        | Same                                                                                                    |
| Setup            | 10,000 spawns alternating A/B, one commit                                                                                                                                                                                                                          | Same                                                                                                    |
| Per commit       | despawn the 1,000 oldest (FIFO), spawn 1,000 alternating A/B with values from the spawn index, one `commit()`                                                                                                                                                      | Same                                                                                                    |
| Warmup / samples | 100 / 1,000 commits                                                                                                                                                                                                                                                | Same                                                                                                    |
| Timed run        | per-commit time (despawn + spawn + commit) only                                                                                                                                                                                                                    | Same                                                                                                    |
| Allocation run   | `node:inspector` `HeapProfiler.startSampling` (32,768-byte interval, GC-collected objects included) over the 1,000 sampled commits; sampled bytes per second. Retained heap after `--expose-gc` `gc()` every 100 sampled commits, reported only as retained memory | Same                                                                                                    |
| GC run           | `--trace-gc`; count and pause total between stdout markers around the sampled commits                                                                                                                                                                              | Same                                                                                                    |

R0 exports only the object `component`; RS and R1 export both overloads; R2 only the schema API.
Numeric width: object fields are JS doubles and schema fields `f64`, so the storage comparison has no
width difference; `width-pass.ts` owns f32/f64.

### Scene and asset cycles

Controls and element ids are identical in R0, RS, R1 and R2 for both pages (`demo/main.ts`
`updateUI` and `examples/platformer/transitions.ts` are unchanged in the relevant logic). Clicks are
`Runtime.evaluate` `click()` with `userGesture`; keys are `Input.dispatchKeyEvent`. Every oracle
times out at 20 s.

**Starfall** (`/`, start after `#play` reads `START FLIGHT`):

| Step | Action         | Completion oracle                                                                        | Dwell |
| ---- | -------------- | ---------------------------------------------------------------------------------------- | ----- |
| 1    | click `#chaos` | `#flight-state` = `CHAOS LAB / INVULNERABLE` (new arena scene and asset preparation)     | 5 s   |
| 2    | click `#pause` | `#flight-state` = `FLIGHT PAUSED` and `#overlay-title` = `TAKE A BREATH.` (overlay push) | 1 s   |
| 3    | click `#pause` | `#flight-state` = `CHAOS LAB / INVULNERABLE` and `#overlay` hidden (overlay pop)         | 2 s   |
| 4    | click `#play`  | `#flight-state` = `FLIGHT IN PROGRESS` (normal arena replaces Chaos)                     | 3 s   |

**Platformer** (`/examples/platformer/`, start after clicking `#start` and `#status` =
`Reach the blue gate`):

| Step | Action                 | Completion oracle                                                                                                          | Dwell |
| ---- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1    | `keyDown` `ArrowRight` | `#status` = `Returning to checkpoint…` (walks into the pit at tile 28)                                                     | 0 s   |
| 2    | `keyUp` `ArrowRight`   | `#status` = `Reach the blue gate` and `#progress` deaths = previous + 1 (respawn scene prepared with the next attempt key) | 1 s   |
| 3    | click `#pause`         | `#status` = `Paused` and `#overlay-title` = `Paused`                                                                       | 1 s   |
| 4    | click `#pause`         | `#status` = `Reach the blue gate` and `#overlay` hidden                                                                    | 1 s   |

- Verification (untimed, 3 cycles per preview, `definitions/preview/`): every oracle passed on R0, RS,
  R1 and R2; Starfall cycles took 11.28–11.55 s and platformer cycles 6.83–6.93 s; visibility stayed
  `visible`, `#error` empty, no owned process survived.
- **N**: Starfall 40 cycles (about 7.5 min), forced GC and retained heap every 4 cycles; platformer
  60 cycles (about 6.9 min), every 6 cycles. Heap snapshots after the first and last checkpoints.
- Checkpoint state: end of step 4, after `HeapProfiler.collectGarbage`.

Expected cardinalities at every checkpoint (heap snapshot object and native node counts; identical at
all three phase 0 checkpoints of each preview). `SceneInstance` is the mounted-scene count. Starfall's
`#sprites` read 316–322 at the checkpoint state; the platformer page exposes no sprite count without
`?baseline`.

| Identity                                        | Starfall R0 |        RS |        R1 |          R2 | Platformer R0 |        RS |        R1 |          R2 |
| ----------------------------------------------- | ----------: | --------: | --------: | ----------: | ------------: | --------: | --------: | ----------: |
| `SceneInstance`                                 |           1 |         1 |         1 |           1 |             1 |         1 |         1 |           1 |
| `SceneCandidate`                                |           2 |         2 |         3 |           3 |             3 |         3 |         4 |           4 |
| `World`                                         |           1 |         1 |         1 |           1 |             1 |         1 |         1 |           1 |
| Query runtimes (object, legacy or schema)       |           2 |         2 |         2 |           2 |             1 |         1 |         1 |           1 |
| `Assets`                                        |           1 |         1 |         1 |           1 |             1 |         1 |         1 |           1 |
| `AudioBuffer`                                   |           2 |         2 |         2 |           2 |             2 |         2 |         2 |           2 |
| `AudioBufferSourceNode`                         |           0 |         0 |         0 |           0 |             2 |         2 |         2 |           2 |
| `GainNode`                                      |           2 |         2 |         2 |           2 |             4 |         4 |         4 |           4 |
| `ImageBitmap`                                   |           0 |         0 |         0 |           2 |             0 |         0 |         0 |           0 |
| `CanvasRenderingContext2D`                      |           2 |         2 |         2 |           1 |             0 |         0 |         0 |           0 |
| `WebGLTexture` / `GPUTexture`                   |       3 / 0 |     3 / 0 |     3 / 0 |       0 / 3 |         2 / 0 |     2 / 0 |     2 / 0 |       0 / 2 |
| `WebGLBuffer` / `GPUBuffer`                     |       2 / 0 |     2 / 0 |     2 / 0 |       0 / 6 |         2 / 0 |     2 / 0 |     2 / 0 |       0 / 5 |
| `GPUBindGroup`, `GPUTextureView`, `GPUSampler`  |           0 |         0 |         0 |     3, 1, 2 |             0 |         0 |         0 |     2, 1, 2 |
| `Float32Array` / `Float64Array` / `ArrayBuffer` |   3 / 0 / 5 | 3 / 0 / 5 | 3 / 0 / 5 | 4 / 21 / 31 |     3 / 0 / 8 | 3 / 0 / 8 | 3 / 0 / 8 | 4 / 12 / 23 |

Intentional caches and pools (bound = the phase 0 checkpoint count for that revision and game):

| Cache or pool                                                     | Owner and snapshot identity                                                                                                                  | Expected bound                                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Decoded asset cache (loaded entries kept after leases reach zero) | `Assets` `entries` map, retaining `AudioBuffer`, the Starfall atlas (`HTMLCanvasElement` at R0–R1, `ImageBitmap` at R2)                      | One entry per asset id: Starfall `ships`, `starfall-music`; platformer `platformer-music` |
| Renderer-owned textures                                           | R0–R1 `Renderer` texture and source maps (`WebGLTexture`); R2 `WebGpuRuntime` image entries (`GPUTexture`, `GPUBindGroup`, `GPUTextureView`) | White texture plus one per image id; counts in the table                                  |
| Pooled renderer and frame buffers                                 | `WebGLBuffer`, `WebGLVertexArrayObject`, `GPUBuffer`; `Frame` typed arrays (`Float32Array`)                                                  | Counts in the table; capacity grows, count does not                                       |
| Typed-array storage                                               | `Float64Array`, `ArrayBuffer` (schema chunk columns and other typed storage at R2; object columns at R0–R1)                                  | Counts in the table                                                                       |
| Prepared scene candidates                                         | `SceneCandidate` per purpose (Starfall pause, result; platformer respawn, next or complete, pause)                                           | Counts in the table                                                                       |
| Audio buses and music voice                                       | `Audio` → `GainNode`, `AudioBufferSourceNode`                                                                                                | Counts in the table                                                                       |

A constructor or native type outside this list whose count grows with cycle count, or a listed
identity above its bound, is leak-candidate evidence under the plan's rule.

### GPU trace definitions

- Categories exposed by Chrome 152 and used: `devtools.timeline`, `gpu`, `gpu.angle`,
  `disabled-by-default-gpu.dawn`, `disabled-by-default-devtools.timeline.frame`, `v8`,
  `disabled-by-default-v8.gc`. Collected from the browser target with `Tracing.start`
  (`ReturnAsStream`) and `IO.read`.
- Alignment proof: Starfall Chaos Lab, 5 s trace after 4 s in Chaos, one run per backend (R1 WebGL,
  R2 WebGPU). Both traces held 301 `FireAnimationFrame` events on `CrRendererMain`, and every compared
  event started inside 300 of 300 rAF intervals.
- Compared per rAF interval (summed duration): `CrGpuMain` `Scheduler::RunTask` (all GPU main-thread
  tasks), `CommandBufferStub::OnAsyncFlush` and `DXGISwapChainImageBacking::Present` on both backends;
  `WebGL` (`gpu`) at R0–R1; `WebGPU` (`gpu`), `WebGPUDecoderImpl::HandleDawnCommands` and
  `Queue::Submit` (`disabled-by-default-gpu.dawn`) at R2. `RasterDecoderImpl::*` events include DOM
  HUD raster and are not compared. GC: renderer main-thread `MinorGC` and `MajorGC` counts and
  durations.
- Label: GPU-process CPU time; not GPU execution time. Descriptive only.

### Renderer fixture serving

Decision (user, 15 September 2026, at phase 0 validation): use this diagnostic fixture build.
`tests/browser-renderer-benchmark.ts` starts from `validation.html`, which no production build
includes; NGNE-21 ran it on the dev server. Verified candidate without tracked changes: a harness Vite
config in the diagnostics directory (`scripts/vite.fixture-plain.config.mjs` `393475d225e9`,
`vite.fixture-hidden.config.mjs` `21b2fe3fff69`) builds only `validation.html` from each export into
`dist-fixture/`; the hidden-map build is byte-identical (2 files, 0 differences at R1 and R2). Served by
`vite preview --strictPort --outDir dist-fixture` with the served-build hash check (asset-list SHA256
R1 `f00a0006…9750`, R2 `4a7048ec…d98b`). R1 `webgl`, R1 `webgpu` and R2 `webgpu`, one-texture and
alternating arms, reached ready with the expected backend and no fixture error: draw calls 1 and 10,000,
upload bytes 560,000 (`webgl`) and 560,048 (`webgpu`), capacity 16,384 and 10,000, one buffer growth,
three bindings. R2 `webgl` is correctly unavailable.

### Phase 0 checks

`npm.cmd test` 141/141 pass; `typecheck`, `build` and `format:check` exit 0; `git diff --check` empty;
`git diff --name-only 86494fd -- src demo examples index.html validation.html` empty.

### Harness (phase 1)

Phase 0 validated by the user on 15 September 2026. Phase 1 produced no timed data; every run below is
a smoke run.

**Driver** `tests/browser-baseline.ts` (SHA256 prefix `1dd57e8f8496`). New behaviour sits behind
environment options documented in the file header; with none set, the run keeps every earlier output
field and adds `longTasksInSample`, `visibilityState`, `backend` and `run`.

- Run isolation: `NGNE_SERVE_DIR` starts `vite preview --strictPort` on the URL port and owns it;
  `NGNE_CDP_PORT` and a fresh profile per run; Chrome and preview are terminated with `taskkill /T`
  and `run.survivingOwnedProcesses` must be empty (non-zero exit otherwise).
- Served-build check: every HTML, JS and CSS file of the expected build is fetched and hashed before
  warmup; a mismatch aborts.
- Backend assertion (`NGNE_EXPECTED_BACKEND`): existing page-canvas context type, probe-canvas WebGL
  renderer string, WebGPU adapter; software renderers and fallback adapters abort.
- Game-mode allocation sampling (`NGNE_ALLOCATION_SAMPLING=1`), 32,768-byte interval with major and
  minor GC-collected objects, unfiltered profile saved with sampled bytes per second and top sites.
- Long tasks counted only when `startTime` lies in the sample window (`longTasksInSample`).
- Cycle mode (`NGNE_CYCLES`): the phase 0 steps, oracles and dwells; forced GC and retained heap every
  N/10 cycles; heap snapshots after the first and last checkpoints; aborts if the page is not visible
  after any cycle.
- Heap snapshots (`NGNE_SNAPSHOTS=1`), browser traces (`NGNE_TRACE=1`, phase 0 categories,
  `ReturnAsStream`, data loss aborts) and retained-heap checkpoints (`NGNE_RETAINED_EVERY_SECONDS`).
- Every artifact must parse with a non-zero node or event count; SHA256 and counts are recorded.
- `visibilityState` at sample start and end (a page hidden from launch fires no `visibilitychange`).
- DevTools calls time out after 180 s and a closed socket fails pending calls; stage markers go to
  stderr.
- DevTools transport is a minimal `node:net` WebSocket client (see findings).

**Diagnostics scripts** (`scripts/` in the diagnostics directory; SHA256 prefixes):

| Script                                | Prefix                          | Purpose                                                                                                                                                       |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chaos-split.ts`                      | `d9352bc8d155`                  | Chaos tick, frame preparation, sort and sum per sample; `--window`; `--profile-window` with source maps                                                       |
| `churn-object.ts` / `churn-schema.ts` | `a0318a66b01a` / `9899df71b7f1` | Phase 0 churn definition; `timed`, `alloc`, `gc` modes; schema file generated by `make-churn-schema.mjs` (`1856c3b70cc7`), only header and definitions differ |
| `width-pass.ts`                       | `830424fd6138`                  | R2 20,000-entity f32 and f64 pass, 300 paired samples, alternating order                                                                                      |
| `gc-parse.mjs`                        | `c2f3f2920e22`                  | `--trace-gc` pauses aligned to the churn window                                                                                                               |
| `snapshot-diff.mjs`                   | `7838444f13b5`                  | Constructor count, self-size and dominator retained-size deltas, shortest retainer path                                                                       |
| `map-sites.mjs`                       | `0dedc9b446ee`                  | Allocation sites through the hidden source maps; native leaves attributed to the JavaScript caller                                                            |
| `profile-map.mjs`                     | `c2c09b544187`                  | Successor of `profile-summary.mjs`: self time per source function and line                                                                                    |
| `check-artifacts.mjs`                 | `ec12eb62ccc9`                  | Artifact gate: parse, count, SHA256, visibility, surviving processes                                                                                          |
| `run-browser.sh`, `phase1-smoke.sh`   | `f326321cf917`, `e16d99db0a21`  | One isolated driver run with manifest; the phase 1 smoke batch                                                                                                |

**Findings while building the harness** (all harness-side; no session 2 candidate):

1. Node 24.15.0's built-in `WebSocket` (undici 7.24.4) raised a `TypeError` and closed the DevTools
   connection (1006) when Chrome sent a 4,261,794-byte `HeapProfiler.stopSampling` reply. It reproduced
   after 10 Starfall cycles with a forced GC per cycle on R1, with or without heap snapshots, while
   60 s plain, snapshot and cycling runs (2.2–2.8 MB replies) returned normally. The earlier driver
   ignored socket close, so the run hung (smoke attempt 1). A raw `node:net` client received the same
   reply intact as valid UTF-8 in 155 ms; a local uncompressed 8 MiB frame reached the built-in client
   normally, so the exact client-side cause (compression is suspected) is not isolated. The driver now
   uses the raw client.
2. Hidden windows: in attempt 1 the R1 cycle page became `hidden` for an unknown reason (no lock or
   standby event). In the final batch the no-option compatibility run started hidden and became
   visible at 13.6 s; the artifact gate rejects it. It directly followed a PowerShell cleanup command
   (suspected focus change, not proven); a standalone rerun passed. Measurement batches open no
   console windows between runs.
3. `--trace-gc` includes a tsx loader worker isolate, and `PerformanceObserver` reports
   incremental-marking entries (kind 8) with no trace line. `gc-parse.mjs` selects the unique isolate
   and shift with 100% pause agreement (all six churn smoke runs) and windows by observer start time.
4. tsx runs single-line transformed modules, so raw CPU profile frames carry only columns.
   `chaos-split.ts` saves each module's inline source map after the profile window and
   `profile-map.mjs` recovers source lines (99.0% of NGNE self time mapped at R2, 99.9% at R0). In game
   bundles engine frames map to `dist/engine/*.js` (compiled lines, exact function names) because the
   engine build emits no source maps; allocation mapping covered 99.5–99.9% of sampled bytes.

**Smoke runs** (5 s sample after 2 s warmup unless cycle mode; `smoke/browser3/`, one manifest each,
all through the served-build check):

| Run                                                      | Backend                  | Artifacts (node or event counts)               | Result                                                                                 |
| -------------------------------------------------------- | ------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| R2 Starfall: allocation, snapshots, retained checkpoints | webgpu                   | allocation 150; snapshots 91,710 and 92,954    | Pass                                                                                   |
| R2 Starfall trace                                        | webgpu                   | trace 90,885 events, 301 rAF                   | Pass                                                                                   |
| R2 platformer: allocation, snapshots, retained           | webgpu                   | allocation 65; snapshots 49,733 and 50,017     | Pass                                                                                   |
| R2 platformer trace                                      | webgpu                   | trace 73,743 events, 301 rAF                   | Pass                                                                                   |
| R2 fixture `webgpu` one texture, snapshots               | webgpu                   | allocation 18; snapshots 45,343 and 45,429     | Pass                                                                                   |
| R2 fixture `webgpu` alternating, trace                   | webgpu                   | allocation 15; trace 126,982 events, 301 rAF   | Pass                                                                                   |
| R1 fixture `webgl` one texture                           | webgl2                   | allocation 16                                  | Pass                                                                                   |
| Starfall 10 cycles R2 / R1 / R0 (allocation sampling)    | webgpu / webgl2 / webgl2 | allocation 749 / 489 / 471; two snapshots each | Pass; 40/40 oracles each; 11.3 s per cycle                                             |
| Platformer 10 cycles R2 / R1 / R0                        | webgpu / webgl2 / webgl2 | two snapshots each                             | Pass; 40/40 oracles each; 6.9 s per cycle                                              |
| R0 Starfall, R1 platformer backend assertion             | webgl2                   | none                                           | Pass                                                                                   |
| R0 page expecting `webgpu` (negative)                    | —                        | —                                              | Aborted: page context webgl2, expected webgpu                                          |
| R0 preview on the port, R2 build expected (negative)     | —                        | —                                              | Aborted: served build does not match (8 files)                                         |
| No new options, R2 preview on 4173                       | webgpu                   | none                                           | Rejected (window hidden at start); standalone rerun passed, all earlier fields present |

Earlier attempts are kept, not reused: `smoke/browser/` (attempt 1, R1 Starfall cycle hung; marked
`HUNG.rejected.txt`) and `smoke/browser2/` (attempt 2, R1 and R0 Starfall cycles failed with the
180 s `stopSampling` timeout; compatibility run never rendered a frame). Snapshot diffs and site mapping
ran on the final cycle artifacts of R0, R1 and R2.

**Node smoke** (`smoke/node-final/`, 25 manifests, empty stderr): `chaos-split.ts` on R0, RS, R1
(`W` = 900) and R2 (`W` = 237, 136 samples); profile windows 237 (R2) and 900 (R0); both churn scripts
in all three modes on every target revision with `gc-parse.mjs` accepted; `width-pass.ts` on R2.

### Phase 1 checks

`npm.cmd test` 141/141 pass; `typecheck`, `build` and `format:check` exit 0; `git diff --check` empty;
protected-path scan empty. `tests/browser-baseline.ts` is outside every tsconfig and the repository has
no Node type declarations, so it is run by tsx without a typecheck, as before.

### CPU measurements (phase 2)

Phase 1 validated by the user on 15 September 2026. The method below was recorded before any phase 2
timed run.

**Batch** `scripts/phase2-cpu.sh` (`aa161303c0cc`), per-run check `scripts/phase2-check.mjs`
(`6505a9cd2ae0`), analysis `scripts/phase2-analyze.mjs` (`22fa57e22f49`), profile comparison
`scripts/profile-diff.mjs` (`a4b3340d303b`). Raw results in `node/phase2/<matrix>/`, `profiles/` and `bench/`.

- Fresh `node` process per run in the export root, the phase 1 script text (the batch aborts if any
  export copy differs from `scripts/`).
- Latin squares are cyclic (row r, position p → condition (r + p) mod k), executed in this order:
  Chaos split (R0, RS, R1, R2; one 4×4 square, `--window 237`); `churn-object` timed, alloc, gc (R0, RS,
  R1; 3×3 each); `churn-schema` timed, alloc, gc (RS, R1, R2; 3×3 each); RS object versus schema
  timed, alloc, gc (two 2×2 squares each); `width-pass.ts` R2 × 3; profiling runs; `npm run bench`.
  97 matrix runs, 7 profiling runs, 8 bench runs.
- Run rejection: non-zero exit, non-empty stderr, wrong `revision`, wrong sample count (Chaos 799
  whole-run and 136 window samples; churn 1,000 commits; width 300 pairs), empty or unparseable heap
  profile, fewer than 11 retained-heap points, `gc-parse.mjs` not accepted or no GC in the window. A
  rejected run rejects its row: files get `.rejected`, a reason file is written, the row reruns (3
  attempts, then stop).
- CPU load percentage is logged before each matrix (`batch.log`), descriptive only.
- Chaos windows from one run: `W` = 237 is `attributableWindow`; `W` = 900 is `wholeRun`. Pairs at
  `W` = 237: R0→RS, RS→R1, R1→R2, R0→R1, R0→R2. Pairs at 900: R0→RS, RS→R1, R0→R1; R1→R2 and R0→R2
  at 900 are labelled non-attributable whole-game evidence.
- Decision metrics: Chaos tick, preparation, sort and sum p50, p95, p99; churn commit p50, p95, p99;
  allocation sampled bytes per commit-second; `--trace-gc` pause total in the window; width-pass
  p50, p95, p99 (f64→f32). Descriptive: bytes per commit, GC count, retained heap at the end and its
  slope.
- Per condition: median of run values, range, range / median. Attributable and noise stop exactly as
  the plan; a metric with any range above 10% is reported within run noise with its ranges.
- Profiles: one run per revision per distinct `W` (R0, RS, R1 at 900 and 237; R2 at 237), summarised
  by `profile-map.mjs`; `profile-diff.mjs` names functions for each pair with an attributable window
  difference above 5%. Not timing evidence.
- Wrapper test before the batch: RS object versus schema (all three modes) and `width-pass.ts` ran
  once through the batch into the session scratchpad to test file handling, manifests and analysis.
  Those 27 runs are not evidence, were not idle-confirmed and are not reused; no rule changed.

**Numeric fields** (source read at R0 and R2; bytes per row count field columns only).

| Game       | Component  | R2 schema fields                                                                                  | Bytes/row | R0 object fields                  |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------- | --------: | --------------------------------- |
| Starfall   | `position` | `x`, `y`, `px`, `py` `f64`                                                                        |        32 | JS numbers                        |
| Starfall   | `body`     | `vx`, `vy`, `radius`, `hp`, `age`, `cooldown` `f64`; `active` `bool`; `kind` `u8`                 |        50 | JS numbers; `active` JS boolean   |
| Starfall   | `visual`   | `sprite` `u8`; `size`, `angle` `f64`                                                              |        17 | JS numbers                        |
| Starfall   | `particle` | `vx`, `vy`, `life`, `maxLife`, `size` `f64`; `color` `u32`                                        |        44 | JS numbers                        |
| Platformer | `position` | `x`, `y`, `px`, `py` `f64`                                                                        |        32 | JS numbers                        |
| Platformer | `body`     | `vx`, `vy`, `w`, `h`, `coyoteTicks`, `jumpBufferTicks`, `previousBottom` `f64`; `grounded` `bool` |        57 | JS numbers; `grounded` JS boolean |
| Platformer | `actor`    | `kind` `u8`; `facing` `f64`                                                                       |         9 | JS numbers                        |

- Columns: `f64` `Float64Array`, `u32` `Uint32Array`, `u8` and `bool` `Uint8Array` (`src/ecs.ts`
  `createColumn`). Every fractional game value stays double precision, as JS numbers at R0; `u8` and
  `u32` fields hold small integer ids and an RGB colour.
- `Frame` narrows to `Float32Array` in all revisions. R0 and RS pack 13 floats (`x`, `y`, `w`, `h`,
  `u`, `v`, `uw`, `vh`, `r`, `g`, `b`, `a`, `angle`): rotation is evaluated from an `f32` angle in the
  WebGL shader. R1 and R2 pack 14 floats (`tx`, `ty`, `ix`, `iy`, `jx`, `jy` from `packAffine` in
  double precision on the CPU, then `u`, `v`, `du`, `dv`, `r`, `g`, `b`, `a`): the affine products
  are narrowed to `f32` instead of the angle.

#### Execution

- 15 September 2026, 16:42:51–16:53:48 UTC; 104 of 104 Node runs accepted (94 matrix, 3 width, 7
  profiling), 0 rejected, no block rerun; 8 bench runs exit 0. Every raw result has a manifest.
- Load before each matrix (`batch.log`, `Win32_Processor.LoadPercentage`, includes the probe's own
  PowerShell start): 1–22%. Idle machine: MANUAL (user) confirmation pending.
- Analysis: `node/phase2-analysis.json` (`5294da919c6f`) and full tables with min–max per condition in
  `node/phase2-analysis.md` (`8de2d19b120b`), both with manifests.

#### Results

Medians of per-run values. **Max range** is the largest same-condition range / median in the row.
Pair cells: change of medians, then **A↑** or **A↓** attributable, **–** within run noise, **N** noise
stop (within run noise, narrowed; never a verdict). Rows marked descriptive never enter classification.
Regression classification (R0→R2 thresholds) belongs to phase 4.

**Chaos split, `W` = 237 window (136 samples; ms per sample)**

| Metric      |     R0 |     RS |     R1 |     R2 | Max range | R0→RS   | RS→R1     | R1→R2    | R0→R1     | R0→R2     |
| ----------- | -----: | -----: | -----: | -----: | --------: | ------- | --------- | -------- | --------- | --------- |
| tick p50    | 0.2488 | 0.2531 | 0.2556 | 0.2633 |        6% | +1.7% – | +1.0% –   | +3.0% –  | +2.8% –   | +5.8% –   |
| tick p95    | 0.3300 | 0.3436 | 0.3519 | 0.4189 |       27% | +4.1% N | +2.4% N   | +19.1% N | +6.6% N   | +26.9% N  |
| tick p99    | 0.3926 | 0.4290 | 0.4041 | 0.5515 |       67% | +9.3% N | -5.8% N   | +36.5% N | +2.9% N   | +40.5% N  |
| prepare p50 | 0.3016 | 0.3002 | 0.2934 | 0.3010 |        3% | -0.5% – | -2.2% A↓  | +2.6% A↑ | -2.7% –   | -0.2% –   |
| prepare p95 | 0.4990 | 0.4933 | 0.3516 | 0.3762 |       10% | -1.2% N | -28.7% A↓ | +7.0% –  | -29.5% N  | -24.6% N  |
| prepare p99 | 0.5458 | 0.5660 | 0.4047 | 0.4432 |       88% | +3.7% N | -28.5% N  | +9.5% N  | -25.9% N  | -18.8% N  |
| sort p50    | 0.0865 | 0.0857 | 0.0887 | 0.0879 |       13% | -0.8% N | +3.4% N   | -0.9% –  | +2.6% –   | +1.7% –   |
| sort p95    | 0.0983 | 0.1021 | 0.1052 | 0.1146 |       51% | +4.0% N | +3.0% N   | +8.9% N  | +7.1% N   | +16.6% N  |
| sort p99    | 0.1426 | 0.1291 | 0.3739 | 0.6213 |       61% | -9.5% N | +189.7% N | +66.1% N | +162.1% N | +335.5% N |
| sum p50     | 0.6484 | 0.6431 | 0.6432 | 0.6691 |        4% | -0.8% – | +0.0% –   | +4.0% A↑ | -0.8% –   | +3.2% –   |
| sum p95     | 0.8492 | 0.8703 | 0.7955 | 0.8763 |       12% | +2.5% N | -8.6% N   | +10.2% N | -6.3% N   | +3.2% N   |
| sum p99     | 0.9275 |  1.017 | 0.9451 |  1.283 |       21% | +9.6% N | -7.1% N   | +35.7% N | +1.9% N   | +38.3% N  |

**Chaos split, whole run (799 samples, `W` = 900; ms per sample)**. R1→R2 and R0→R2 are
non-attributable whole-game evidence (R2's simulation diverges at tick 238).

| Metric      |     R0 |     RS |     R1 |     R2 | Max range | R0→RS    | RS→R1     | R0→R1     | R1→R2     | R0→R2     |
| ----------- | -----: | -----: | -----: | -----: | --------: | -------- | --------- | --------- | --------- | --------- |
| tick p50    | 0.2384 | 0.2447 | 0.2421 | 0.2043 |        4% | +2.6% A↑ | -1.1% –   | +1.5% A↑  | -15.6% A↓ | -14.3% A↓ |
| tick p95    | 0.3113 | 0.3181 | 0.3139 | 0.3578 |        7% | +2.2% –  | -1.3% –   | +0.8% –   | +14.0% A↑ | +15.0% A↑ |
| tick p99    | 0.4100 | 0.4316 | 0.4018 | 0.4741 |       16% | +5.3% N  | -6.9% N   | -2.0% N   | +18.0% N  | +15.6% N  |
| prepare p50 | 0.3033 | 0.3041 | 0.2941 | 0.3017 |        5% | +0.3% –  | -3.3% A↓  | -3.0% –   | +2.5% A↑  | -0.6% –   |
| prepare p95 | 0.4850 | 0.4772 | 0.3481 | 0.3665 |        9% | -1.6% –  | -27.1% A↓ | -28.2% A↓ | +5.3% –   | -24.4% A↓ |
| prepare p99 | 0.6347 | 0.6144 | 0.4454 | 0.4546 |       21% | -3.2% N  | -27.5% N  | -29.8% N  | +2.1% N   | -28.4% N  |
| sort p50    | 0.0863 | 0.0862 | 0.0888 | 0.0881 |       13% | -0.1% N  | +3.0% N   | +2.9% A↑  | -0.7% –   | +2.1% A↑  |
| sort p95    | 0.1028 | 0.1057 | 0.1003 | 0.1088 |       11% | +2.9% N  | -5.1% N   | -2.4% –   | +8.4% –   | +5.8% A↑  |
| sort p99    | 0.1376 | 0.1485 | 0.3650 | 0.6769 |       44% | +7.9% N  | +145.8% N | +165.2% N | +85.5% N  | +391.9% N |
| sum p50     | 0.6319 | 0.6412 | 0.6298 | 0.6062 |        2% | +1.5% –  | -1.8% A↓  | -0.3% –   | -3.7% A↓  | -4.1% A↓  |
| sum p95     | 0.8484 | 0.8594 | 0.7771 | 0.8111 |        6% | +1.3% –  | -9.6% A↓  | -8.4% A↓  | +4.4% –   | -4.4% –   |
| sum p99     |  1.039 |  1.018 | 0.9520 |  1.329 |       10% | -2.0% –  | -6.5% –   | -8.4% A↓  | +39.6% N  | +27.9% N  |

**`churn-object.ts` (R0 native, RS and R1 legacy bridge)**

| Metric                                   |     R0 |     RS |     R1 | Max range | R0→RS     | RS→R1    | R0→R1     |
| ---------------------------------------- | -----: | -----: | -----: | --------: | --------- | -------- | --------- |
| commit p50 (ms)                          | 0.3238 | 0.3328 | 0.3297 |        7% | +2.8% –   | -0.9% –  | +1.8% –   |
| commit p95 (ms)                          | 0.4964 | 0.5079 | 0.5243 |        9% | +2.3% –   | +3.2% –  | +5.6% –   |
| commit p99 (ms)                          | 0.7007 |  1.177 |  1.148 |       40% | +67.9% N  | -2.4% N  | +63.9% N  |
| allocation GiB/s                         |  2.753 |  2.111 |  2.117 |        4% | -23.3% A↓ | +0.3% –  | -23.1% A↓ |
| GC pause total (ms)                      | 13.880 | 25.540 | 25.090 |      115% | +84.0% N  | -1.8% N  | +80.8% N  |
| descriptive: allocation MiB/commit       |  1.141 |  0.890 |  0.885 |        2% | -22.0% A↓ | -0.5% –  | -22.4% A↓ |
| descriptive: GC count                    |     61 |     30 |     30 |       80% | -50.8% N  | +0.0% N  | -50.8% N  |
| descriptive: retained heap at end (MiB)  | 10.412 | 10.706 | 10.987 |        0% | +2.8% A↑  | +2.6% A↑ | +5.5% A↑  |
| descriptive: retained slope (KiB/100 c.) |  1.438 |  1.439 |  1.423 |        0% | +0.1%     | -1.1%    | -1.1%     |

**`churn-schema.ts` (RS, R1, R2)**

| Metric                                   |     RS |     R1 |     R2 | Max range | RS→R1    | R1→R2    | RS→R2    |
| ---------------------------------------- | -----: | -----: | -----: | --------: | -------- | -------- | -------- |
| commit p50 (ms)                          |  2.637 |  2.590 |  2.593 |        4% | -1.8% –  | +0.1% –  | -1.6% –  |
| commit p95 (ms)                          |  3.173 |  3.134 |  3.094 |       25% | -1.2% –  | -1.3% N  | -2.5% N  |
| commit p99 (ms)                          |  4.836 |  4.978 |  3.473 |       49% | +2.9% N  | -30.2% N | -28.2% N |
| allocation GiB/s                         |  1.611 |  1.599 |  1.550 |        5% | -0.7% –  | -3.1% –  | -3.8% –  |
| GC pause total (ms)                      | 62.820 | 63.340 | 34.240 |       45% | +0.8% N  | -45.9% N | -45.5% N |
| descriptive: allocation MiB/commit       |  4.949 |  4.948 |  4.788 |        1% | -0.0% –  | -3.2% A↓ | -3.3% A↓ |
| descriptive: GC count                    |     78 |     79 |     74 |        1% | +1.3% –  | -6.3% A↓ | -5.1% A↓ |
| descriptive: retained heap at end (MiB)  |  9.607 |  9.887 |  9.807 |        0% | +2.9% A↑ | -0.8% A↓ | +2.1% A↑ |
| descriptive: retained slope (KiB/100 c.) |  1.476 |  1.413 |  1.512 |        9% | -4.3%    | +7.0%    | +2.4%    |

**Same-revision churn at RS, object versus schema (causal SoA comparison)**

| Metric                                   | RS object | RS schema | Max range | Object→schema |
| ---------------------------------------- | --------: | --------: | --------: | ------------- |
| commit p50 (ms)                          |    0.3439 |     2.638 |       12% | +667.0% N     |
| commit p95 (ms)                          |    0.5386 |     3.197 |       17% | +493.7% N     |
| commit p99 (ms)                          |     1.290 |     4.890 |      116% | +279.1% N     |
| allocation GiB/s                         |     2.099 |     1.570 |        2% | -25.2% A↓     |
| GC pause total (ms)                      |    22.580 |    65.275 |      102% | +189.1% N     |
| descriptive: allocation MiB/commit       |     0.887 |     4.965 |        2% | +459.7% A↑    |
| descriptive: GC count                    |        30 |        79 |       37% | +163.3% N     |
| descriptive: retained heap at end (MiB)  |    10.705 |     9.609 |        0% | -10.2% A↓     |
| descriptive: retained slope (KiB/100 c.) |     1.438 |     1.598 |       16% | +11.1% N      |

**`width-pass.ts` at R2, 20,000 entities (ms per pass)**

| Metric   |    f64 |    f32 | Max range | f64→f32  |
| -------- | -----: | -----: | --------: | -------- |
| pass p50 | 0.2224 | 0.2136 |        3% | -4.0% A↓ |
| pass p95 | 0.2488 | 0.2351 |        7% | -5.5% –  |
| pass p99 | 0.2964 | 0.3030 |        7% | +2.2% –  |

#### Observations for phase 4

Statements of what the rules produced; classification and ranking are phase 4.

1. **Chaos, R0→R2 inside `W` = 237:** no decision metric is attributable. Sum p50 +3.2% and tick p50
   +5.8% are within run noise (overlapping runs); every p95 and p99 except preparation p95 hits the
   noise stop. The NGNE-27 lead (7–12% slower Chaos window) is not reproduced as attributable here.
2. **Chaos, R1→R2 inside `W` = 237:** sum p50 +4.0% and preparation p50 +2.6% attributable; both
   below 5%.
3. **Chaos sort p99** rises from about 0.13–0.15 ms (R0, RS) to 0.37 ms (R1) and 0.62–0.68 ms (R2) in
   both windows; noise stop on every pair (ranges 11–61%). Recorded as narrowed.
4. **Same-revision churn:** schema per-commit time is 7.7 times object at p50 (every schema run
   2.595–2.663 ms, every object run 0.327–0.367 ms), but object's range is 11.7% of its median, so
   the predeclared noise stop applies and it is reported within run noise. Sampled allocation per
   commit is 5.6 times object (descriptive) while the decision metric, bytes per second, is 25% lower
   because commits take longer; GC count 30→79 is also noise-stopped. **Open decision below.**
5. **`churn-schema.ts` RS→R2:** no attributable change in time or allocation rate; allocation per
   commit -3.3% (descriptive). The schema churn cost measured at RS persists at R2.
6. **`churn-object.ts` R0→RS:** allocation rate -23.3% attributable (improvement); retained heap at the
   end +0.29 MiB (descriptive); GC pause total noise-stopped (one RS run 43 ms).
7. **f32/f64 at R2:** f32 p50 4.0% faster than f64 (attributable); p95 and p99 within run noise.
8. **Retained heap slope** in every churn arm is 1.4–1.6 KiB per 100 commits, including R0 (consistent
   with the harness's own growing sample arrays; not isolated); no arm differs attributably.
9. **Whole-run Chaos, R0→R2 (non-attributable):** tick p50 -14.3%, tick p95 +15.0%, sum p50 -4.1%,
   sum p99 +27.9% (noise stop). The games diverge after tick 237, so these compare different play.

#### CPU profiles

One profiling run per revision and window (`profiles/`, manifests, `profile-map.mjs` summaries, 100 µs
sampling, not timing evidence). `profile-diff.mjs` outputs are `profiles/diff-<W>-<X>-<Y>.json`. Self
time covers tick, preparation and sort together, so a function is a candidate cause, not a measured
segment share. Functions whose line moved between revisions appear as a removal plus an addition.

Attributable window differences above 5%: RS→R1 preparation p95 (`W` 237 and 900), RS→R1 sum p95,
R0→R1 preparation p95, sum p95 and sum p99 (`W` 900). All are improvements.

| Pair, `W`  | NGNE self ms X→Y | Largest self-time differences (ms)                                                                                                                                                                   |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RS→R1, 900 | 591 → 546        | `each` `src/ecs.ts` 88.7 → 52.4 (-36.3); `Frame.sort` plus comparator 70.9 → 75.6 (+4.7, lines moved); `runsDuringFreeze` `demo/game.ts:479` +16.6; `packAffine` +8.6 (new); `demo/game.ts:488` -8.9 |
| RS→R1, 237 | 96 → 96          | `demo/game.ts:526` +11.6; `each` `src/ecs.ts` -4.9; `demo/game.ts:524` -4.6; `runsDuringFreeze` +3.7; sort and comparator +2.3 net                                                                   |
| R0→R1, 900 | 629 → 546        | `each` `src/ecs.ts` 72.9 → 52.4 (-20.5); `demo/game.ts:526` -25.6; `demo/game.ts:488` -25.3; sort and comparator 82.4 → 75.6 (-6.8)                                                                  |

Descriptive (no attributable difference above 5%): R1→R2 and R0→R2 at `W` = 237 total 96 → 99 and
97 → 99 ms. R2 restructures the Starfall systems (`demo/game.ts:516`, `:557` and
`commitSceneSimulation` `src/scene.ts:734` at 24.4 ms are new keys; `:488` and `:526` are gone), so
line keys do not pair across R1→R2.

#### `npm run bench` (historical record, not an A/B)

Two runs per revision in the order R0, RS, R1, R2, R0, RS, R1, R2 (`bench/`). Chaos follows an ECS
workload in the same process. Each run printed `fatal: not a git repository` on stderr
(`tests/benchmark.ts` asks git for the revision inside an export; `revision` reads `unknown`); exit 0.

| Revision | ECS p50 (ms) | Chaos p50 / p95 (ms)         | Collision grid p50 (ms)                  |
| -------- | ------------ | ---------------------------- | ---------------------------------------- |
| R0       | 0.313, 0.257 | 0.667 / 0.857, 0.642 / 0.817 | —                                        |
| RS       | 0.203, 0.199 | 0.765 / 0.980, 0.768 / 0.971 | legacy 1.007, 0.997; schema 1.121, 1.090 |
| R1       | 0.199, 0.198 | 0.735 / 0.872, 0.759 / 1.131 | legacy 0.995, 0.981; schema 1.117, 1.098 |
| R2       | 0.191, 0.192 | 0.607 / 0.796, 0.614 / 0.807 | schema 1.125, 1.159                      |

#### Phase 2 checks

`npm.cmd test` 141/141 pass; `typecheck`, `build` and `format:check` exit 0; `git diff --check` empty;
protected-path scan empty.

#### Decisions (phase 2)

The user confirmed on 15 September 2026 that the machine was idle with nothing running during the
block, and validated phase 2. Two points were raised at the stop report; no rule change was
authorized, so both stay as predeclared:

1. **Noise stop on the same-revision churn time.** The rule gives "within run noise" for a 7.7× fully
   separated difference because one object run is 11.7% from its median. It is carried into phase 4
   as narrowed, with the ranges and observation 4.
2. **Allocation normalisation.** The decision metric (sampled bytes per commit-second) reverses
   direction against bytes per commit when per-commit time differs 7.7×. Bytes per commit stays
   descriptive.

### Browser measurements (phase 3)

The method below was recorded before any phase 3 timed run.

**Scripts** (diagnostics `scripts/`, SHA256 prefixes): batch `phase3-browser.sh` `8842515b03b1`,
per-run check `phase3-check.mjs` `d073ee32b9d2`, analysis `phase3-analyze.mjs` `86060852a70c`, trace
summary `trace-summary.mjs` `7fb935f215fc` (successor of `trace-align.mjs`), classifier
`cycle-classify.mjs` `0d37afc93f5d`, `snapshot-diff.mjs` `2ba4ad608ede` (phase 1 script plus a
`grownByCount` list of every constructor whose count grew); unchanged `run-browser.sh`
`f326321cf917`, `check-artifacts.mjs` `ec12eb62ccc9`, `map-sites.mjs` `0dedc9b446ee`, driver
`tests/browser-baseline.ts` `1dd57e8f8496`. Raw results in `browser/phase3/<matrix>/`.

- One isolated driver run at a time (own preview port from 4600 and CDP port from 9700, fresh
  profile, served-build check, backend assertion). No PowerShell or console window starts during a
  block. Heavy post-processing (snapshot diffs, trace summaries, site mapping) runs after the block.
- Plumbing test before any block: one 60 s `fixture-one` R1 `webgl` run into the session scratchpad
  (81 s wall time, accepted). Not evidence, not reused.

| Matrix or run        | Conditions                                       | Options (every run: 10 s warmup, `NGNE_EXPECTED_BACKEND`)                                     | Runs             |
| -------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------- |
| `starfall60`         | R0, R1, R2                                       | Chaos Lab, 60 s, `NGNE_ALLOCATION_SAMPLING=1`                                                 | 3×3 square       |
| `platformer60`       | R0, R1, R2                                       | Level 1 idle, 60 s, allocation sampling                                                       | 3×3 square       |
| `fixture-one`        | R1 `webgl`, R1 `webgpu`, R2 `webgpu`             | `alternating=0`, 60 s (fixture always samples allocations)                                    | 3×3 square       |
| `fixture-alt`        | same                                             | `alternating=1`, 60 s                                                                         | 3×3 square       |
| `starfall300`        | R0, R2                                           | 300 s, allocation sampling, snapshots at sample start and end, retained checkpoint every 30 s | 1 each           |
| `trace-*`            | Starfall R0, R1, R2; both fixture arms × 3 modes | `NGNE_TRACE=1`, 60 s, no allocation sampling                                                  | 1 each (9)       |
| `cycle-starfall`     | R0, R2                                           | `NGNE_CYCLES=40`                                                                              | 1 each           |
| `cycle-platformer`   | R0, R2                                           | `NGNE_CYCLES=60`                                                                              | 1 each           |
| `rs-<workload>`      | R0, RS, R1                                       | as the triggering 60 s workload                                                               | 3×3 if triggered |
| `confirm-<workload>` | R0, R1, R2                                       | as the triggering long or cycle workload                                                      | 3×3 if triggered |

- Latin squares are cyclic; a rejected run rejects its row (directories get `.rejected` and a reason
  file; the row reruns, at most 3 attempts). A descriptive run retries once, then the batch stops.
- Run rejection (`phase3-check.mjs`): driver exit non-zero; `check-artifacts.mjs` failure (artifact
  parse, count or SHA256; visibility not `visible` at both ends or any change; surviving owned
  process); no served-build hash; page context or fixture mode not the expected backend; page or
  fixture error; sample shorter than 98% of its duration; Starfall flight state not
  `CHAOS LAB / INVULNERABLE` at both ends; platformer status not `Reach the blue gate` at both ends
  or progress text changed during the sample (the idle player died); any cycle oracle short of N, or
  not 10 checkpoints.
- Decision metrics, 60 s games: frame callback and frame interval p50, p95, p99; sampled allocation
  MiB/s; reclaimed MiB/s (`performance.memory` drops, lower-bound proxy); dropped ticks (attributable
  only when every Y run is above 0 and no X run is). Fixture: CPU preparation, submission and total
  p50, p95, p99, plus the game metrics. Long runs: retained slope MiB/min. Cycles: retained slope per
  checkpoint. Descriptive: intervals over 25 ms, long tasks in the sample, heap drops, heap maxima,
  retained heap after warmup and after the run, fixture upload bytes and draw calls. Attribution and
  noise stop as in phase 2. Pairs: R0→R1, R1→R2, R0→R2; fixture R1 `webgl`→R1 `webgpu`, R1
  `webgpu`→R2 `webgpu`, R1 `webgl`→R2 `webgpu`; RS submatrix R0→RS, RS→R1, R0→R1.
- RS submatrix trigger: any 60 s game decision metric with R0→R1 attributable.
- Leak and cache classification (`cycle-classify.mjs`), applying the plan's rule with these
  definitions: checkpoints are the 10 cycle checkpoints or the 10 long-run checkpoints; a
  **grown constructor** has a snapshot count delta at least equal to the cycles (or 30 s intervals)
  elapsed between the two snapshots; listed caches and bounds are the phase 0 table (query runtimes
  = `QueryRuntime`, `LegacyQueryRuntime`, `SchemaQueryRuntime`; listed identities without a count
  there are never within bound). The strict classification counts every grown constructor. Growth
  from the performance timeline the driver observes (long-task, long-animation-frame, script and
  attribution entries) is listed as harness-owned, with a second classification excluding it
  reported alongside.
- A leak candidate, or a leak or bounded-cache classification that would inform a fix-or-accept
  decision, triggers the confirmation matrix for that workload.
- GPU trace summary: phase 0 compared events on `CrGpuMain` per rAF interval (p50, p95, p99, total)
  and renderer-main `MinorGC` and `MajorGC` counts and durations. Labelled GPU-process CPU time, not
  GPU execution time; descriptive only.

**Blocks and machine time** (runs take about 81 s per 60 s sample):

| Block | Content                                                              |                                                        Machine time |
| ----- | -------------------------------------------------------------------- | ------------------------------------------------------------------: |
| 1     | `starfall60`, `platformer60`, `fixture-one`, `fixture-alt` (36 runs) |                                                        about 50 min |
| 2     | `starfall300` ×2, 9 trace runs, 4 cycle runs                         |                                                        about 55 min |
| 3+    | RS submatrix and confirmation matrices if triggered                  | 13 min per 60 s submatrix; 60–70 min per cycle or long confirmation |

#### Block 1 execution

- 15 September 2026, 17:33:07–18:21:21 UTC, after the user's go. 36 of 36 runs accepted, 0 rejected,
  no row rerun; every run passed the served-build, backend, visibility and artifact checks and has a
  manifest. The user confirmed the block was not interrupted.
- Analysis `browser/phase3-analysis.json` (`140dabce444e`, manifest). Allocation sites for the 18 game
  runs through the hidden source maps: `sites.json` per run (manifests; mapped fraction 99%+).
- Dropped ticks were 0 in every run and long tasks in the sample 0 in every run (rows omitted).
- Timer resolution: page `performance.now()` and rAF timestamps are coarsened to 0.1 ms here, so
  callback and fixture CPU percentiles are multiples of 0.1 ms and interval differences of one quantum
  (for example 17.2 → 17.1 ms, or identical 16.7 ms medians flagged by floating-point residue) are
  at the timer's resolution.

#### Block 1 results

Cells as in phase 2 (medians of run values; A↑/A↓ attributable, – within run noise, N noise stop).

**Starfall Chaos Lab, 60 s**

| Metric                                   |    R0 |    R1 |    R2 | Max range | R0→R1     | R1→R2      | R0→R2     |
| ---------------------------------------- | ----: | ----: | ----: | --------: | --------- | ---------- | --------- |
| callback p50 (ms)                        |  4.40 |  4.60 |  5.20 |       31% | +4.5% –   | +13.0% N   | +18.2% N  |
| callback p95 (ms)                        |  6.80 |  6.80 |  7.50 |       19% | 0.0% –    | +10.3% N   | +10.3% N  |
| callback p99 (ms)                        |  8.20 |  8.30 |  8.80 |       10% | +1.2% –   | +6.0% N    | +7.3% N   |
| interval p50 (ms)                        | 16.70 | 16.70 | 16.70 |        0% | 0.0% –    | 0.0% –     | 0.0% –    |
| interval p95 (ms)                        | 17.00 | 17.00 | 17.00 |        1% | 0.0% –    | 0.0% –     | 0.0% –    |
| interval p99 (ms)                        | 17.20 | 17.20 | 17.10 |        1% | 0.0% –    | -0.6% A↓   | -0.6% A↓  |
| allocation MiB/s                         | 45.61 | 35.15 | 17.66 |        2% | -22.9% A↓ | -49.8% A↓  | -61.3% A↓ |
| reclaimed MiB/s                          | 7.278 | 2.425 | 7.587 |        9% | -66.7% A↓ | +212.9% A↑ | +4.3% –   |
| descriptive: heap drops                  |   154 |    82 |    91 |       10% | -46.8% A↓ | +11.0% –   | -40.9% A↓ |
| descriptive: heap used max (MiB)         | 17.87 | 11.50 | 18.04 |        4% | -35.6% A↓ | +56.9% A↑  | +1.0% –   |
| descriptive: heap total max (MiB)        | 34.00 | 22.09 | 33.67 |        1% | -35.0% A↓ | +52.4% A↑  | -1.0% A↓  |
| descriptive: retained after warmup (MiB) | 5.052 | 4.799 | 6.526 |        4% | -5.0% A↓  | +36.0% A↑  | +29.2% A↑ |
| descriptive: retained after run (MiB)    | 6.515 | 6.608 | 6.451 |       30% | +1.4% N   | -2.4% N    | -1.0% N   |

**Platformer level 1 idle, 60 s**

| Metric                                   |    R0 |    R1 |    R2 | Max range | R0→R1     | R1→R2    | R0→R2     |
| ---------------------------------------- | ----: | ----: | ----: | --------: | --------- | -------- | --------- |
| callback p50 (ms)                        |  0.80 |  0.80 |  0.90 |       22% | 0.0% N    | +12.5% N | +12.5% N  |
| callback p95 (ms)                        |  1.40 |  1.40 |  1.50 |       20% | 0.0% –    | +7.1% N  | +7.1% N   |
| callback p99 (ms)                        |  1.60 |  1.70 |  1.90 |       21% | +6.2% –   | +11.8% N | +18.7% N  |
| interval p50 (ms)                        | 16.70 | 16.70 | 16.70 |        0% | 0.0% –    | 0.0% –   | 0.0% –    |
| interval p95 (ms)                        | 17.10 | 17.10 | 17.00 |        1% | 0.0% –    | -0.6% –  | -0.6% –   |
| interval p99 (ms)                        | 17.30 | 17.30 | 17.20 |        1% | 0.0% –    | -0.6% –  | -0.6% –   |
| allocation MiB/s                         | 0.631 | 0.543 | 0.580 |        7% | -13.8% A↓ | +6.8% –  | -8.0% A↓  |
| reclaimed MiB/s                          | 0.512 | 0.453 | 0.432 |        2% | -11.4% A↓ | -4.8% A↓ | -15.6% A↓ |
| descriptive: heap drops                  |    51 |    44 |    48 |        4% | -13.7% A↓ | +9.1% A↑ | -5.9% A↓  |
| descriptive: heap used max (MiB)         | 3.338 | 3.385 | 3.305 |        3% | +1.4% –   | -2.4% –  | -1.0% –   |
| descriptive: heap total max (MiB)        | 4.890 | 4.938 | 5.126 |       10% | +1.0% N   | +3.8% –  | +4.8% N   |
| descriptive: retained after warmup (MiB) | 1.823 | 1.884 | 1.985 |        1% | +3.4% A↑  | +5.3% A↑ | +8.9% A↑  |
| descriptive: retained after run (MiB)    | 2.008 | 2.061 | 2.088 |        1% | +2.7% A↑  | +1.3% A↑ | +4.0% A↑  |

**Renderer fixture, one texture (1 draw call)** — pairs: A = R1 WebGL→R1 WebGPU, B = R1 WebGPU→R2
WebGPU, C = R1 WebGL→R2 WebGPU.

| Metric                                |           R1 WebGL |          R1 WebGPU |          R2 WebGPU | Max range | A         | B       | C         |
| ------------------------------------- | -----------------: | -----------------: | -----------------: | --------: | --------- | ------- | --------- |
| CPU preparation p50 (ms)              |               1.00 |               1.00 |               1.00 |       40% | 0.0% N    | 0.0% N  | 0.0% –    |
| CPU preparation p95 (ms)              |               1.40 |               1.40 |               1.40 |       21% | 0.0% N    | 0.0% N  | 0.0% N    |
| CPU preparation p99 (ms)              |               1.80 |               1.70 |               1.70 |       29% | -5.6% N   | 0.0% N  | -5.6% –   |
| CPU submission p50 (ms)               |               3.30 |               2.80 |               2.90 |       32% | -15.2% N  | +3.6% N | -12.1% N  |
| CPU submission p95 (ms)               |               4.30 |               3.80 |               3.90 |       29% | -11.6% N  | +2.6% N | -9.3% A↓  |
| CPU submission p99 (ms)               |               5.00 |               4.30 |               4.30 |       23% | -14.0% N  | 0.0% N  | -14.0% A↓ |
| CPU total p50 (ms)                    |               4.50 |               3.90 |               3.90 |       33% | -13.3% N  | 0.0% N  | -13.3% A↓ |
| CPU total p95 (ms)                    |               5.50 |               4.90 |               5.00 |       27% | -10.9% N  | +2.0% N | -9.1% A↓  |
| CPU total p99 (ms)                    |               6.10 |               5.50 |               5.60 |       24% | -9.8% N   | +1.8% N | -8.2% –   |
| callback p50 (ms)                     |               4.50 |               4.00 |               4.00 |       33% | -11.1% N  | 0.0% N  | -11.1% A↓ |
| callback p95 (ms)                     |               5.60 |               5.00 |               5.10 |       26% | -10.7% N  | +2.0% N | -8.9% A↓  |
| callback p99 (ms)                     |               6.20 |               5.60 |               5.70 |       23% | -9.7% N   | +1.8% N | -8.1% –   |
| interval p50 / p95 / p99 (ms)         | 16.7 / 17.1 / 17.4 | 16.7 / 17.1 / 17.3 | 16.7 / 17.1 / 17.3 |        1% | –         | –       | –         |
| allocation MiB/s                      |              36.71 |              2.416 |              2.422 |        3% | -93.4% A↓ | +0.3% – | -93.4% A↓ |
| reclaimed MiB/s                       |              0.412 |              0.671 |              0.622 |       61% | +62.9% N  | -7.4% N | +50.9% N  |
| descriptive: heap drops               |                 42 |                172 |                176 |       48% | +309.5% N | +2.3% – | +319.0% N |
| descriptive: heap total max (MiB)     |              10.11 |               9.52 |               9.53 |        5% | -5.8% A↓  | +0.1% – | -5.8% A↓  |
| descriptive: retained after run (MiB) |              4.738 |              4.490 |              4.471 |       13% | -5.2% N   | -0.4% – | -5.6% N   |

**Renderer fixture, alternating textures (10,000 draw calls)** — pairs A, B, C as above.

| Metric                                | R1 WebGL | R1 WebGPU | R2 WebGPU | Max range | A          | B        | C          |
| ------------------------------------- | -------: | --------: | --------: | --------: | ---------- | -------- | ---------- |
| CPU preparation p50 (ms)              |     0.10 |      0.30 |      0.30 |      100% | +200.0% N  | 0.0% N   | +200.0% N  |
| CPU preparation p95 (ms)              |     0.30 |      0.50 |      0.50 |       40% | +66.7% N   | 0.0% N   | +66.7% N   |
| CPU preparation p99 (ms)              |     0.30 |      0.80 |      0.90 |       44% | +166.7% N  | +12.5% N | +200.0% N  |
| CPU submission p50 (ms)               |    21.30 |      2.40 |      2.40 |       13% | -88.7% A↓  | 0.0% N   | -88.7% N   |
| CPU submission p95 (ms)               |    23.30 |      3.90 |      4.50 |       33% | -83.3% A↓  | +15.4% N | -80.7% N   |
| CPU submission p99 (ms)               |    24.20 |      5.30 |      5.90 |       41% | -78.1% N   | +11.3% N | -75.6% N   |
| CPU total p50 (ms)                    |    21.50 |      2.70 |      2.70 |       15% | -87.4% A↓  | 0.0% N   | -87.4% N   |
| CPU total p95 (ms)                    |    23.50 |      4.30 |      4.90 |       35% | -81.7% A↓  | +14.0% N | -79.1% N   |
| CPU total p99 (ms)                    |    24.30 |      5.70 |      6.40 |       41% | -76.5% N   | +12.3% N | -73.7% N   |
| callback p50 (ms)                     |    21.50 |      2.80 |      2.70 |       11% | -87.0% A↓  | -3.6% N  | -87.4% N   |
| callback p95 (ms)                     |    23.50 |      4.40 |      5.00 |       32% | -81.3% A↓  | +13.6% N | -78.7% N   |
| callback p99 (ms)                     |    24.40 |      5.80 |      6.50 |       40% | -76.2% N   | +12.1% N | -73.4% N   |
| interval p50 (ms)                     |    16.70 |     16.70 |     16.70 |        0% | 0.0% A↓\*  | 0.0% –   | 0.0% A↓\*  |
| interval p95 (ms)                     |    33.40 |     17.00 |     17.00 |        1% | -49.1% A↓  | 0.0% –   | -49.1% A↓  |
| interval p99 (ms)                     |    33.50 |     17.20 |     17.20 |        1% | -48.7% A↓  | 0.0% –   | -48.7% A↓  |
| allocation MiB/s                      |    28.07 |     2.370 |     2.391 |        4% | -91.6% A↓  | +0.9% –  | -91.5% A↓  |
| reclaimed MiB/s                       |    1.396 |     0.622 |     0.639 |       64% | -55.5% N   | +2.7% –  | -54.3% N   |
| descriptive: intervals > 25 ms        |      835 |         0 |         0 |        8% | -100.0% A↓ | –        | -100.0% A↓ |
| descriptive: heap drops               |      116 |       177 |       177 |        2% | +52.6% A↑  | 0.0% –   | +52.6% A↑  |
| descriptive: retained after run (MiB) |    5.308 |     4.450 |     4.516 |        2% | -16.2% A↓  | +1.5% –  | -14.9% A↓  |

\* Floating-point residue below the 0.1 ms timer quantum, not a frame-interval difference.

Full tables, including every descriptive row and min–max per condition, are in the analysis JSON.

#### Block 1 observations for phase 4

1. **Starfall R0→R2:** no time metric is attributable. Callback p50 +18.2% and p95 +10.3% (the
   plan's browser threshold is p95 +10%) hit the noise stop (ranges 19–31%). Frame intervals are
   unchanged at the 0.1 ms quantum; 0 dropped ticks and 0 intervals over 25 ms in every run.
2. **Starfall allocation:** sampled allocation falls R0 45.6 → R1 35.2 → R2 17.7 MiB/s, attributable at
   every step. Top sites: R0 and R1 `native subarray <- renderer.js render` (22.7 MiB/s, WebGL
   upload) and `demo/game.ts:526` at R0; R2 `demo/game.ts:570`, `:516`, `:371`, `:557`, `:436`
   `chunk` callbacks (1.2–3.3 MiB/s each) and `createChunkDescriptor` `ecs.js:537` (1.1 MiB/s).
3. **Starfall reclaimed rate** (the NGNE-27 lead, 2.4 → 7.8 MiB/s at R1→R2) reproduces as R1→R2
   +213% attributable, but R0 is 7.3 MiB/s and R0→R2 is within run noise: R1 was the low point. Heap
   maxima follow the same R1 dip. Retained heap after warmup is +1.5 MiB R0→R2 (attributable,
   descriptive); after the run it is within noise.
4. **Platformer R0→R2:** allocation -8.0% and reclaimed -15.6% (attributable improvements); callback
   percentiles noise-stopped at 0.8–1.9 ms; retained after warmup +0.16 MiB (+8.9%, descriptive). R2's
   top site is `createChunkDescriptor` (`ecs.js:537`, 0.14 MiB/s, plus its native `entries`).
5. **Fixture R1 WebGPU→R2 WebGPU:** no attributable difference on any metric; p95/p99 submission and
   total are noise-stopped (+11–15% medians). WebGPU versus WebGL in R1: alternating submission
   21.3 → 2.4 ms p50 and interval p95 33.4 → 17.0 ms (WebGL misses every other frame, 835 intervals
   over 25 ms); allocation 28–37 → 2.4 MiB/s in both arms.
6. **RS submatrix triggered** for `starfall60` (R0→R1 allocation and reclaimed rate, both lower) and
   `platformer60` (same two metrics). The plan triggers on any attributable R0→R1 decision metric,
   improvements included.

#### Block 2 execution and observations

- 15 September 2026, 18:36:31–19:55:37 UTC, after the user's go: RS submatrices for `starfall60` and
  `platformer60`, `starfall300`, 9 trace runs, 4 cycle runs. 33 of 33 runs accepted, 0 rejected.
  Uninterrupted-block confirmation: given by the user on 16 September 2026.
- Post-processing after the block (`phase3-post.sh`): site maps, snapshot diffs, classifications and
  trace summaries, each with a manifest; tables below are written by `phase3-report.mjs`.
- RS submatrices: the R0→R1 allocation decrease sits at RS→R1 in both games (Starfall -23.9%,
  platformer -16.6%); R0→RS is within run noise.
- `starfall300`: R0 is a **leak candidate** (retained 4.76 → 5.93 MiB, +1.17 MiB, slope 0.038
  MiB/min; `Object` +1,890); R2 is unclassified (retained falls 1.0 MiB). A leak candidate triggers
  the confirmation matrix `confirm-starfall300` (R0, R1, R2, 3 runs each).
- Cycles: all four runs unclassified under the strict rule, with or without harness-owned growth.
  Retained growth 0.95 MiB (Starfall R0 and R2) and 0.67–0.71 MiB (platformer R0 and R2) over 9
  checkpoints: below the 1 MiB leak-candidate bound, above the 0.05 MiB per checkpoint bounded bound;
  R0 and R2 are within 0.05 MiB of each other in both games. No confirmation trigger.

<!-- ngne12:phase3-block2:start -->

**rs-starfall60** (runs R0 3, R1 3, RS 3; rejected rows 0)

| Metric                                       |    R0 |    R1 |    RS | Max range | R0→RS   | RS→R1     | R0→R1     |
| -------------------------------------------- | ----: | ----: | ----: | --------: | ------- | --------- | --------- |
| callback p50 (ms)                            | 4.600 | 4.500 | 4.700 |       28% | +2.2% N | -4.3% –   | -2.2% N   |
| callback p95 (ms)                            | 6.900 | 6.900 | 7.000 |       19% | +1.4% N | -1.4% –   | +0.0% N   |
| callback p99 (ms)                            | 8.200 | 8.300 | 8.600 |       16% | +4.9% N | -3.5% –   | +1.2% N   |
| interval p50 (ms)                            | 16.70 | 16.70 | 16.70 |        0% | +0.0% – | +0.0% –   | +0.0% –   |
| interval p95 (ms)                            | 17.00 | 17.00 | 17.00 |        1% | +0.0% – | +0.0% –   | +0.0% –   |
| interval p99 (ms)                            | 17.20 | 17.20 | 17.20 |        1% | +0.0% – | +0.0% –   | +0.0% –   |
| allocation MiB/s                             | 45.30 | 34.99 | 45.96 |        1% | +1.5% – | -23.9% A↓ | -22.8% A↓ |
| reclaimed MiB/s (lower-bound proxy)          | 6.920 | 2.533 | 7.217 |       11% | +4.3% – | -64.9% N  | -63.4% N  |
| dropped ticks                                | 0.000 | 0.000 | 0.000 |        0% | — –     | — –       | — –       |
| descriptive: intervals > 25 ms               | 0.000 | 0.000 | 0.000 |        0% | — –     | — –       | — –       |
| descriptive: long tasks in sample            | 0.000 | 0.000 | 0.000 |        0% | — –     | — –       | — –       |
| descriptive: heap drops (performance.memory) |   152 | 87.00 |   153 |       14% | +0.7% – | -43.1% N  | -42.8% N  |
| descriptive: heap used max (MiB)             | 18.07 | 11.31 | 18.26 |        3% | +1.1% – | -38.1% A↓ | -37.4% A↓ |
| descriptive: heap total max (MiB)            | 33.50 | 22.09 | 34.26 |        2% | +2.3% – | -35.5% A↓ | -34.0% A↓ |
| descriptive: retained after warmup (MiB)     | 4.893 | 4.792 | 4.930 |       17% | +0.8% N | -2.8% A↓  | -2.1% N   |
| descriptive: retained after run (MiB)        | 4.546 | 6.608 | 4.657 |       42% | +2.4% N | +41.9% N  | +45.3% N  |

**rs-platformer60** (runs R0 3, R1 3, RS 3; rejected rows 0)

| Metric                                       |    R0 |    R1 |    RS | Max range | R0→RS   | RS→R1     | R0→R1     |
| -------------------------------------------- | ----: | ----: | ----: | --------: | ------- | --------- | --------- |
| callback p50 (ms)                            | 0.800 | 0.800 | 0.800 |        0% | +0.0% – | +0.0% –   | +0.0% –   |
| callback p95 (ms)                            | 1.500 | 1.400 | 1.400 |       21% | -6.7% – | -0.0% N   | -6.7% N   |
| callback p99 (ms)                            | 1.800 | 1.700 | 1.700 |       18% | -5.6% N | -0.0% N   | -5.6% N   |
| interval p50 (ms)                            | 16.70 | 16.70 | 16.70 |        0% | +0.0% – | +0.0% –   | +0.0% –   |
| interval p95 (ms)                            | 17.00 | 17.00 | 17.10 |        1% | +0.6% – | -0.6% –   | +0.0% –   |
| interval p99 (ms)                            | 17.20 | 17.20 | 17.20 |        1% | +0.0% – | -0.0% –   | +0.0% –   |
| allocation MiB/s                             | 0.659 | 0.540 | 0.647 |        6% | -1.8% – | -16.6% A↓ | -18.1% A↓ |
| reclaimed MiB/s (lower-bound proxy)          | 0.511 | 0.456 | 0.517 |        2% | +1.1% – | -11.7% A↓ | -10.7% A↓ |
| dropped ticks                                | 0.000 | 0.000 | 0.000 |        0% | — –     | — –       | — –       |
| descriptive: intervals > 25 ms               | 0.000 | 0.000 | 0.000 |        0% | — –     | — –       | — –       |
| descriptive: long tasks in sample            | 0.000 | 0.000 | 0.000 |        0% | — –     | — –       | — –       |
| descriptive: heap drops (performance.memory) | 52.00 | 45.00 | 53.00 |        4% | +1.9% – | -15.1% A↓ | -13.5% A↓ |
| descriptive: heap used max (MiB)             | 3.308 | 3.335 | 3.313 |        4% | +0.2% – | +0.7% –   | +0.8% –   |
| descriptive: heap total max (MiB)            | 5.390 | 4.688 | 5.151 |       11% | -4.4% – | -9.0% N   | -13.0% N  |
| descriptive: retained after warmup (MiB)     | 1.793 | 1.879 | 1.819 |        3% | +1.4% – | +3.3% A↑  | +4.8% A↑  |
| descriptive: retained after run (MiB)        | 1.967 | 2.066 | 1.993 |        2% | +1.3% – | +3.7% A↑  | +5.0% A↑  |

**Starfall Chaos Lab, 300 s (descriptive)**

| Run   | Callback p50 / p95 / p99 (ms) | Allocation MiB/s | Reclaimed MiB/s | Retained at 30 s → 300 s (MiB) | Slope (MiB/min) | Classification (strict; excluding harness) | Grown constructors (count delta)                                                                                                                    | Top sites (MiB/s)                                                                                                                 |
| ----- | ----------------------------- | ---------------: | --------------: | ------------------------------ | --------------: | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| R0-a1 | 4.300 / 6.400 / 7.700         |            46.83 |           5.640 | 4.763 → 5.933                  |           0.038 | leak candidate; leak candidate             | `Object` +1890; `system / PropertyArray` +218; `system / WeakArrayList` +35; `blink::FragmentDataList` +18; `blink::ComputedStyle` +16; `Array` +15 | native subarray <- dist/engine/renderer.js:219 render 24.08; demo/game.ts:526 (anonymous) 8.94; demo/game.ts:537 (anonymous) 4.41 |
| R2-a1 | 3.700 / 5.900 / 7.400         |            17.05 |           3.854 | 6.500 → 5.495                  |          -0.250 | unclassified; unclassified                 | `Object` +686; `system / PropertyArray` +314; `system / WeakArrayList` +28; `blink::FragmentDataList` +18; `blink::ComputedStyle` +16; `Array` +13  | demo/game.ts:570 chunk 6.24; demo/game.ts:516 chunk 1.73; native sort <- dist/engine/renderer.js:63 sort 1.67                     |

**GPU-process trace, 60 s (GPU-process CPU time per rAF interval, p50 / p95 ms; not GPU execution time; descriptive)**

| Run                            | rAF frames | Scheduler::RunTask | CommandBufferStub::OnAsyncFlush | DXGISwapChainImageBacking::Present | WebGL         | WebGPU      | WebGPUDecoderImpl::HandleDawnCommands | Queue::Submit | MinorGC count / ms | MajorGC count / ms |
| ------------------------------ | ---------: | ------------------ | ------------------------------- | ---------------------------------- | ------------- | ----------- | ------------------------------------- | ------------- | ------------------ | ------------------ |
| trace-starfall R0-a1           |       3602 | 3.50 / 6.47        | 2.47 / 4.47                     | 0.29 / 0.64                        | 0.36 / 0.55   | —           | —                                     | —             | 294 / 178.7        | 34 / 120.9         |
| trace-starfall R1-a1           |       3599 | 3.59 / 6.73        | 1.64 / 3.20                     | 0.55 / 0.92                        | 0.35 / 0.52   | —           | —                                     | —             | 568 / 292.4        | 33 / 143.5         |
| trace-starfall R2-a1           |       3601 | 5.02 / 8.07        | 3.40 / 5.74                     | 0.28 / 0.64                        | —             | 0.72 / 1.15 | 0.50 / 0.84                           | 0.25 / 0.42   | 130 / 114.6        | 37 / 115.5         |
| trace-fixture-one R1-webgl-a1  |       3602 | 2.91 / 5.33        | 0.79 / 1.25                     | 0.63 / 0.95                        | 0.80 / 1.27   | —           | —                                     | —             | 2193 / 1374.1      | 0 / 0              |
| trace-fixture-one R1-webgpu-a1 |       3601 | 2.10 / 3.34        | 0.99 / 1.79                     | 0.21 / 0.33                        | —             | 1.00 / 1.82 | 0.71 / 1.37                           | 0.34 / 0.71   | 178 / 123.1        | 0 / 0              |
| trace-fixture-one R2-webgpu-a1 |       3602 | 2.07 / 3.33        | 0.99 / 1.83                     | 0.22 / 0.33                        | —             | 1.00 / 1.86 | 0.72 / 1.42                           | 0.35 / 0.74   | 175 / 141.9        | 0 / 0              |
| trace-fixture-alt R1-webgl-a1  |       2794 | 21.27 / 23.61      | 20.82 / 23.12                   | 0.10 / 0.13                        | 20.86 / 23.17 | —           | —                                     | —             | 893 / 157.2        | 0 / 0              |
| trace-fixture-alt R1-webgpu-a1 |       3602 | 4.94 / 6.76        | 4.06 / 5.50                     | 0.15 / 0.46                        | —             | 4.06 / 5.51 | 3.91 / 5.31                           | 1.75 / 2.44   | 171 / 51.1         | 0 / 0              |
| trace-fixture-alt R2-webgpu-a1 |       3602 | 4.92 / 6.65        | 4.06 / 5.27                     | 0.16 / 0.48                        | —             | 4.07 / 5.27 | 3.91 / 5.09                           | 1.73 / 2.36   | 170 / 54.6         | 0 / 0              |

**Starfall cycles (descriptive)**

| Run   | Cycles, oracles passed | Cycle time mean (ms) | Retained per checkpoint (MiB)                              | Slope all / last half (MiB per checkpoint) | Growth (MiB) | Classification (strict; excluding harness) | Grown constructors (count delta) |
| ----- | ---------------------- | -------------------: | ---------------------------------------------------------- | ------------------------------------------ | -----------: | ------------------------------------------ | -------------------------------- |
| R0-a1 | 40, 40/40/40/40        |                11277 | 3.10, 3.24, 3.36, 3.45, 3.51, 3.53, 3.72, 3.71, 3.73, 4.05 | 0.088 / 0.105                              |        0.946 | unclassified; unclassified                 | none                             |
| R2-a1 | 40, 40/40/40/40        |                11282 | 3.83, 3.98, 4.07, 4.10, 4.24, 4.33, 4.44, 4.45, 4.48, 4.78 | 0.091 / 0.094                              |        0.956 | unclassified; unclassified                 | none                             |

**Platformer cycles (descriptive)**

| Run   | Cycles, oracles passed | Cycle time mean (ms) | Retained per checkpoint (MiB)                              | Slope all / last half (MiB per checkpoint) | Growth (MiB) | Classification (strict; excluding harness) | Grown constructors (count delta)                                                                        |
| ----- | ---------------------- | -------------------: | ---------------------------------------------------------- | ------------------------------------------ | -----------: | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| R0-a1 | 60, 60/60/60/60        |                 6894 | 2.04, 2.22, 2.23, 2.32, 2.47, 2.45, 2.46, 2.65, 2.69, 2.70 | 0.071 / 0.075                              |        0.666 | unclassified; unclassified                 | `DOMRectReadOnly` +250; `LayoutShift` +125; `LayoutShiftAttribution` +125                               |
| R2-a1 | 60, 60/60/60/60        |                 6895 | 2.24, 2.41, 2.42, 2.51, 2.66, 2.63, 2.65, 2.88, 2.91, 2.95 | 0.076 / 0.090                              |        0.712 | unclassified; unclassified                 | `DOMRectReadOnly` +250; `LayoutShift` +125; `LayoutShiftAttribution` +125; `system / WeakArrayList` +58 |

<!-- ngne12:phase3-block2:end -->

#### Phase 3 decisions and checks

- **Confirmation matrix waived** by the user on 16 September 2026: `confirm-starfall300` (triggered
  by the R0-only leak candidate) was not run, and phase 3 closed with the data above. Consequence for
  phase 4: no leak or bounded-cache classification is confirmed for any revision; `starfall300` and
  the cycle runs stay descriptive (one run each), so "confirmed leak" cannot be claimed or excluded
  by replicated evidence. This is an evidence gap for phase 5.
- Cycle growth in the platformer is dominated by `DOMRectReadOnly`, `LayoutShift` and
  `LayoutShiftAttribution` (browser performance-timeline entries, same counts at R0 and R2); these are
  outside the harness-owned pattern, so the strict and harness-excluded classifications agree.
- Block 2 uninterrupted confirmation (MANUAL, user): confirmed on 16 September 2026; the machine ran
  block 2 (15 September, 18:36–19:55 UTC) without interruption.
- Scripts after block 2: `phase3-post.sh` `921fe8e6c8f2`, `phase3-report.mjs` `2e4d14321a59`;
  analysis `browser/phase3-analysis.json` `9cbd92997c61` (both blocks, manifest).
- Gate (16 September 2026): `npm.cmd test` 141/141 pass; `typecheck`, `build` and `format:check` exit
  0; `git diff --check` empty; protected-path scan empty.

### Analysis (phase 4)

Inputs: `node/phase2-analysis.json` (`5294da919c6f`) and `browser/phase3-analysis.json`
(`9cbd92997c61`). The tables between the markers below are written by `phase4-report.mjs` (diagnostics
`scripts/`, `1f491132ca2b`), which applies the plan's regression rule unchanged and also writes
`phase4-classification.json` (`9bb5a77a6e3d`, manifest). Everything here is local evidence from one machine (see
[local limits](#local-limits-phase-4)).

<!-- ngne12:phase4:start -->

#### Before and after, R0→R2

Medians of the run values; range is the largest same-condition range over the median. Classification applies the predeclared rule to R0→R2 in that matrix only.

| Workload                          | Metric                              |    R0 |    RS |    R1 |    R2 | Max range |   R0→R2 | Runs separated    | Classification        |
| --------------------------------- | ----------------------------------- | ----: | ----: | ----: | ----: | --------: | ------: | ----------------- | --------------------- |
| Chaos split (Node, ms per sample) | W237 tick p50                       | 0.249 | 0.253 | 0.256 | 0.263 |        6% |   +5.8% | no                | within run noise      |
| Chaos split (Node, ms per sample) | W237 tick p95                       | 0.330 | 0.344 | 0.352 | 0.419 |       27% |  +26.9% | up, gap > range   | noise stop (narrowed) |
| Chaos split (Node, ms per sample) | W237 tick p99                       | 0.393 | 0.429 | 0.404 | 0.552 |       67% |  +40.5% | up, gap ≤ range   | noise stop (narrowed) |
| Chaos split (Node, ms per sample) | W237 prepare p50                    | 0.302 | 0.300 | 0.293 | 0.301 |        3% |   -0.2% | no                | within run noise      |
| Chaos split (Node, ms per sample) | W237 prepare p95                    | 0.499 | 0.493 | 0.352 | 0.376 |       10% |  -24.6% | down, gap > range | noise stop (narrowed) |
| Chaos split (Node, ms per sample) | W237 prepare p99                    | 0.546 | 0.566 | 0.405 | 0.443 |       88% |  -18.8% | no                | noise stop (narrowed) |
| Chaos split (Node, ms per sample) | W237 sort p50                       | 0.086 | 0.086 | 0.089 | 0.088 |       13% |   +1.7% | no                | within run noise      |
| Chaos split (Node, ms per sample) | W237 sort p95                       | 0.098 | 0.102 | 0.105 | 0.115 |       51% |  +16.6% | no                | noise stop (narrowed) |
| Chaos split (Node, ms per sample) | W237 sort p99                       | 0.143 | 0.129 | 0.374 | 0.621 |       61% | +335.5% | up, gap > range   | noise stop (narrowed) |
| Chaos split (Node, ms per sample) | W237 sum p50                        | 0.648 | 0.643 | 0.643 | 0.669 |        4% |   +3.2% | no                | within run noise      |
| Chaos split (Node, ms per sample) | W237 sum p95                        | 0.849 | 0.870 | 0.796 | 0.876 |       12% |   +3.2% | no                | noise stop (narrowed) |
| Chaos split (Node, ms per sample) | W237 sum p99                        | 0.927 |  1.02 | 0.945 |  1.28 |       21% |  +38.3% | up, gap > range   | noise stop (narrowed) |
| Starfall Chaos Lab 60 s (browser) | callback p50 (ms)                   |  4.40 |     — |  4.60 |  5.20 |       31% |  +18.2% | no                | noise stop (narrowed) |
| Starfall Chaos Lab 60 s (browser) | callback p95 (ms)                   |  6.80 |     — |  6.80 |  7.50 |       19% |  +10.3% | no                | noise stop (narrowed) |
| Starfall Chaos Lab 60 s (browser) | callback p99 (ms)                   |  8.20 |     — |  8.30 |  8.80 |       10% |   +7.3% | no                | noise stop (narrowed) |
| Starfall Chaos Lab 60 s (browser) | interval p50 (ms)                   |  16.7 |     — |  16.7 |  16.7 |        0% |   +0.0% | no                | within run noise      |
| Starfall Chaos Lab 60 s (browser) | interval p95 (ms)                   |  17.0 |     — |  17.0 |  17.0 |        1% |   +0.0% | no                | within run noise      |
| Starfall Chaos Lab 60 s (browser) | interval p99 (ms)                   |  17.2 |     — |  17.2 |  17.1 |        1% |   -0.6% | down, gap > range | improvement           |
| Starfall Chaos Lab 60 s (browser) | allocation MiB/s                    |  45.6 |     — |  35.1 |  17.7 |        2% |  -61.3% | down, gap > range | improvement           |
| Starfall Chaos Lab 60 s (browser) | reclaimed MiB/s (lower-bound proxy) |  7.28 |     — |  2.42 |  7.59 |        9% |   +4.3% | up, gap ≤ range   | within run noise      |
| Starfall Chaos Lab 60 s (browser) | dropped ticks                       | 0.000 |     — | 0.000 | 0.000 |        0% |       — | no                | within run noise      |
| Starfall Chaos Lab 60 s (browser) | intervals > 25 ms                   | 0.000 |     — | 0.000 | 0.000 |        0% |       — | no                | descriptive           |
| Starfall Chaos Lab 60 s (browser) | long tasks in sample                | 0.000 |     — | 0.000 | 0.000 |        0% |       — | no                | descriptive           |
| Starfall Chaos Lab 60 s (browser) | heap drops (performance.memory)     |   154 |     — |  82.0 |  91.0 |       10% |  -40.9% | down, gap > range | descriptive decrease  |
| Starfall Chaos Lab 60 s (browser) | heap used max (MiB)                 |  17.9 |     — |  11.5 |  18.0 |        4% |   +1.0% | no                | descriptive           |
| Starfall Chaos Lab 60 s (browser) | heap total max (MiB)                |  34.0 |     — |  22.1 |  33.7 |        1% |   -1.0% | down, gap > range | descriptive decrease  |
| Starfall Chaos Lab 60 s (browser) | retained after warmup (MiB)         |  5.05 |     — |  4.80 |  6.53 |        4% |  +29.2% | up, gap > range   | descriptive increase  |
| Starfall Chaos Lab 60 s (browser) | retained after run (MiB)            |  6.52 |     — |  6.61 |  6.45 |       30% |   -1.0% | no                | descriptive           |
| Platformer idle 60 s (browser)    | callback p50 (ms)                   | 0.800 |     — | 0.800 | 0.900 |       22% |  +12.5% | no                | noise stop (narrowed) |
| Platformer idle 60 s (browser)    | callback p95 (ms)                   |  1.40 |     — |  1.40 |  1.50 |       20% |   +7.1% | no                | noise stop (narrowed) |
| Platformer idle 60 s (browser)    | callback p99 (ms)                   |  1.60 |     — |  1.70 |  1.90 |       21% |  +18.7% | no                | noise stop (narrowed) |
| Platformer idle 60 s (browser)    | interval p50 (ms)                   |  16.7 |     — |  16.7 |  16.7 |        0% |   +0.0% | no                | within run noise      |
| Platformer idle 60 s (browser)    | interval p95 (ms)                   |  17.1 |     — |  17.1 |  17.0 |        1% |   -0.6% | no                | within run noise      |
| Platformer idle 60 s (browser)    | interval p99 (ms)                   |  17.3 |     — |  17.3 |  17.2 |        1% |   -0.6% | no                | within run noise      |
| Platformer idle 60 s (browser)    | allocation MiB/s                    | 0.631 |     — | 0.543 | 0.580 |        7% |   -8.0% | down, gap > range | improvement           |
| Platformer idle 60 s (browser)    | reclaimed MiB/s (lower-bound proxy) | 0.512 |     — | 0.453 | 0.432 |        2% |  -15.6% | down, gap > range | improvement           |
| Platformer idle 60 s (browser)    | dropped ticks                       | 0.000 |     — | 0.000 | 0.000 |        0% |       — | no                | within run noise      |
| Platformer idle 60 s (browser)    | intervals > 25 ms                   | 0.000 |     — | 0.000 | 0.000 |        0% |       — | no                | descriptive           |
| Platformer idle 60 s (browser)    | long tasks in sample                | 0.000 |     — | 0.000 | 0.000 |        0% |       — | no                | descriptive           |
| Platformer idle 60 s (browser)    | heap drops (performance.memory)     |  51.0 |     — |  44.0 |  48.0 |        4% |   -5.9% | down, gap > range | descriptive decrease  |
| Platformer idle 60 s (browser)    | heap used max (MiB)                 |  3.34 |     — |  3.38 |  3.31 |        3% |   -1.0% | no                | descriptive           |
| Platformer idle 60 s (browser)    | heap total max (MiB)                |  4.89 |     — |  4.94 |  5.13 |       10% |   +4.8% | no                | descriptive           |
| Platformer idle 60 s (browser)    | retained after warmup (MiB)         |  1.82 |     — |  1.88 |  1.98 |        1% |   +8.9% | up, gap > range   | descriptive increase  |
| Platformer idle 60 s (browser)    | retained after run (MiB)            |  2.01 |     — |  2.06 |  2.09 |        1% |   +4.0% | up, gap > range   | descriptive increase  |

Whole-run Chaos rows (outside `W` = 237) are in the phase 2 table and are not attributable; RS runs only in the Node matrix. Dropped ticks are 0 in every run of both browser matrices.

#### Matrices without an R0→R2 pair

The regression rule needs R0→R2 inside one matrix, so these rows are not classified as regressions or minor. They carry attribution for the pairs they contain.

| Matrix                    | Metric                              | Medians                                          | Max range | Pairs (change, verdict)                                                                                           |
| ------------------------- | ----------------------------------- | ------------------------------------------------ | --------: | ----------------------------------------------------------------------------------------------------------------- |
| churn-object timed        | commit p50                          | R0 0.324; RS 0.333; R1 0.330                     |        7% | R0→RS +2.8% noise; RS→R1 -0.9% noise; R0→R1 +1.8% noise                                                           |
| churn-object timed        | commit p95                          | R0 0.496; RS 0.508; R1 0.524                     |        9% | R0→RS +2.3% noise; RS→R1 +3.2% noise; R0→R1 +5.6% noise                                                           |
| churn-object timed        | commit p99                          | R0 0.701; RS 1.18; R1 1.15                       |       40% | R0→RS +67.9% noise stop; RS→R1 -2.4% noise stop; R0→R1 +63.9% noise stop                                          |
| churn-object alloc        | allocation bytes/s                  | R0 2819 MiB/s; RS 2162 MiB/s; R1 2168 MiB/s      |        4% | R0→RS -23.3% A↓; RS→R1 +0.3% noise; R0→R1 -23.1% A↓                                                               |
| churn-object gc           | GC pause total ms                   | R0 13.9; RS 25.5; R1 25.1                        |      115% | R0→RS +84.0% noise stop; RS→R1 -1.8% noise stop; R0→R1 +80.8% noise stop                                          |
| churn-schema timed        | commit p50                          | RS 2.64; R1 2.59; R2 2.59                        |        4% | RS→R1 -1.8% noise; R1→R2 +0.1% noise; RS→R2 -1.6% noise                                                           |
| churn-schema timed        | commit p95                          | RS 3.17; R1 3.13; R2 3.09                        |       25% | RS→R1 -1.2% noise; R1→R2 -1.3% noise stop; RS→R2 -2.5% noise stop                                                 |
| churn-schema timed        | commit p99                          | RS 4.84; R1 4.98; R2 3.47                        |       49% | RS→R1 +2.9% noise stop; R1→R2 -30.2% noise stop; RS→R2 -28.2% noise stop                                          |
| churn-schema alloc        | allocation bytes/s                  | RS 1650 MiB/s; R1 1638 MiB/s; R2 1587 MiB/s      |        5% | RS→R1 -0.7% noise; R1→R2 -3.1% noise; RS→R2 -3.8% noise                                                           |
| churn-schema gc           | GC pause total ms                   | RS 62.8; R1 63.3; R2 34.2                        |       45% | RS→R1 +0.8% noise stop; R1→R2 -45.9% noise stop; RS→R2 -45.5% noise stop                                          |
| RS object vs schema timed | commit p50                          | RS-object 0.344; RS-schema 2.64                  |       12% | RS-object→RS-schema +667.0% noise stop                                                                            |
| RS object vs schema timed | commit p95                          | RS-object 0.539; RS-schema 3.20                  |       17% | RS-object→RS-schema +493.7% noise stop                                                                            |
| RS object vs schema timed | commit p99                          | RS-object 1.29; RS-schema 4.89                   |      116% | RS-object→RS-schema +279.1% noise stop                                                                            |
| RS object vs schema alloc | allocation bytes/s                  | RS-object 2149 MiB/s; RS-schema 1608 MiB/s       |        2% | RS-object→RS-schema -25.2% A↓                                                                                     |
| RS object vs schema gc    | GC pause total ms                   | RS-object 22.6; RS-schema 65.3                   |      102% | RS-object→RS-schema +189.1% noise stop                                                                            |
| width-pass R2             | pass p50                            | f64 0.222; f32 0.214                             |        3% | f64→f32 -4.0% A↓                                                                                                  |
| width-pass R2             | pass p95                            | f64 0.249; f32 0.235                             |        7% | f64→f32 -5.5% noise                                                                                               |
| width-pass R2             | pass p99                            | f64 0.296; f32 0.303                             |        7% | f64→f32 +2.2% noise                                                                                               |
| fixture-one               | CPU submission p50 (ms)             | R1-webgl 3.30; R1-webgpu 2.80; R2-webgpu 2.90    |       32% | R1-webgl→R1-webgpu -15.2% noise stop; R1-webgpu→R2-webgpu +3.6% noise stop; R1-webgl→R2-webgpu -12.1% noise stop  |
| fixture-one               | CPU submission p95 (ms)             | R1-webgl 4.30; R1-webgpu 3.80; R2-webgpu 3.90    |       29% | R1-webgl→R1-webgpu -11.6% noise stop; R1-webgpu→R2-webgpu +2.6% noise stop; R1-webgl→R2-webgpu -9.3% A↓           |
| fixture-one               | CPU submission p99 (ms)             | R1-webgl 5.00; R1-webgpu 4.30; R2-webgpu 4.30    |       23% | R1-webgl→R1-webgpu -14.0% noise stop; R1-webgpu→R2-webgpu +0.0% noise stop; R1-webgl→R2-webgpu -14.0% A↓          |
| fixture-one               | CPU total p50 (ms)                  | R1-webgl 4.50; R1-webgpu 3.90; R2-webgpu 3.90    |       33% | R1-webgl→R1-webgpu -13.3% noise stop; R1-webgpu→R2-webgpu +0.0% noise stop; R1-webgl→R2-webgpu -13.3% A↓          |
| fixture-one               | CPU total p95 (ms)                  | R1-webgl 5.50; R1-webgpu 4.90; R2-webgpu 5.00    |       27% | R1-webgl→R1-webgpu -10.9% noise stop; R1-webgpu→R2-webgpu +2.0% noise stop; R1-webgl→R2-webgpu -9.1% A↓           |
| fixture-one               | CPU total p99 (ms)                  | R1-webgl 6.10; R1-webgpu 5.50; R2-webgpu 5.60    |       24% | R1-webgl→R1-webgpu -9.8% noise stop; R1-webgpu→R2-webgpu +1.8% noise stop; R1-webgl→R2-webgpu -8.2% noise         |
| fixture-one               | callback p50 (ms)                   | R1-webgl 4.50; R1-webgpu 4.00; R2-webgpu 4.00    |       33% | R1-webgl→R1-webgpu -11.1% noise stop; R1-webgpu→R2-webgpu +0.0% noise stop; R1-webgl→R2-webgpu -11.1% A↓          |
| fixture-one               | callback p95 (ms)                   | R1-webgl 5.60; R1-webgpu 5.00; R2-webgpu 5.10    |       26% | R1-webgl→R1-webgpu -10.7% noise stop; R1-webgpu→R2-webgpu +2.0% noise stop; R1-webgl→R2-webgpu -8.9% A↓           |
| fixture-one               | callback p99 (ms)                   | R1-webgl 6.20; R1-webgpu 5.60; R2-webgpu 5.70    |       23% | R1-webgl→R1-webgpu -9.7% noise stop; R1-webgpu→R2-webgpu +1.8% noise stop; R1-webgl→R2-webgpu -8.1% noise         |
| fixture-one               | interval p95 (ms)                   | R1-webgl 17.1; R1-webgpu 17.1; R2-webgpu 17.1    |        1% | R1-webgl→R1-webgpu +0.0% noise; R1-webgpu→R2-webgpu +0.0% noise; R1-webgl→R2-webgpu +0.0% noise                   |
| fixture-one               | interval p99 (ms)                   | R1-webgl 17.4; R1-webgpu 17.3; R2-webgpu 17.3    |        1% | R1-webgl→R1-webgpu -0.6% noise; R1-webgpu→R2-webgpu +0.0% noise; R1-webgl→R2-webgpu -0.6% noise                   |
| fixture-one               | allocation MiB/s                    | R1-webgl 36.7; R1-webgpu 2.42; R2-webgpu 2.42    |        3% | R1-webgl→R1-webgpu -93.4% A↓; R1-webgpu→R2-webgpu +0.3% noise; R1-webgl→R2-webgpu -93.4% A↓                       |
| fixture-one               | reclaimed MiB/s (lower-bound proxy) | R1-webgl 0.412; R1-webgpu 0.671; R2-webgpu 0.622 |       61% | R1-webgl→R1-webgpu +62.9% noise stop; R1-webgpu→R2-webgpu -7.4% noise stop; R1-webgl→R2-webgpu +50.9% noise stop  |
| fixture-one               | dropped ticks                       | R1-webgl 0.000; R1-webgpu 0.000; R2-webgpu 0.000 |        0% | R1-webgl→R1-webgpu — noise; R1-webgpu→R2-webgpu — noise; R1-webgl→R2-webgpu — noise                               |
| fixture-alt               | CPU submission p50 (ms)             | R1-webgl 21.3; R1-webgpu 2.40; R2-webgpu 2.40    |       13% | R1-webgl→R1-webgpu -88.7% A↓; R1-webgpu→R2-webgpu -0.0% noise stop; R1-webgl→R2-webgpu -88.7% noise stop          |
| fixture-alt               | CPU submission p95 (ms)             | R1-webgl 23.3; R1-webgpu 3.90; R2-webgpu 4.50    |       33% | R1-webgl→R1-webgpu -83.3% A↓; R1-webgpu→R2-webgpu +15.4% noise stop; R1-webgl→R2-webgpu -80.7% noise stop         |
| fixture-alt               | CPU submission p99 (ms)             | R1-webgl 24.2; R1-webgpu 5.30; R2-webgpu 5.90    |       41% | R1-webgl→R1-webgpu -78.1% noise stop; R1-webgpu→R2-webgpu +11.3% noise stop; R1-webgl→R2-webgpu -75.6% noise stop |
| fixture-alt               | CPU total p50 (ms)                  | R1-webgl 21.5; R1-webgpu 2.70; R2-webgpu 2.70    |       15% | R1-webgl→R1-webgpu -87.4% A↓; R1-webgpu→R2-webgpu +0.0% noise stop; R1-webgl→R2-webgpu -87.4% noise stop          |
| fixture-alt               | CPU total p95 (ms)                  | R1-webgl 23.5; R1-webgpu 4.30; R2-webgpu 4.90    |       35% | R1-webgl→R1-webgpu -81.7% A↓; R1-webgpu→R2-webgpu +14.0% noise stop; R1-webgl→R2-webgpu -79.1% noise stop         |
| fixture-alt               | CPU total p99 (ms)                  | R1-webgl 24.3; R1-webgpu 5.70; R2-webgpu 6.40    |       41% | R1-webgl→R1-webgpu -76.5% noise stop; R1-webgpu→R2-webgpu +12.3% noise stop; R1-webgl→R2-webgpu -73.7% noise stop |
| fixture-alt               | callback p50 (ms)                   | R1-webgl 21.5; R1-webgpu 2.80; R2-webgpu 2.70    |       11% | R1-webgl→R1-webgpu -87.0% A↓; R1-webgpu→R2-webgpu -3.6% noise stop; R1-webgl→R2-webgpu -87.4% noise stop          |
| fixture-alt               | callback p95 (ms)                   | R1-webgl 23.5; R1-webgpu 4.40; R2-webgpu 5.00    |       32% | R1-webgl→R1-webgpu -81.3% A↓; R1-webgpu→R2-webgpu +13.6% noise stop; R1-webgl→R2-webgpu -78.7% noise stop         |
| fixture-alt               | callback p99 (ms)                   | R1-webgl 24.4; R1-webgpu 5.80; R2-webgpu 6.50    |       40% | R1-webgl→R1-webgpu -76.2% noise stop; R1-webgpu→R2-webgpu +12.1% noise stop; R1-webgl→R2-webgpu -73.4% noise stop |
| fixture-alt               | interval p95 (ms)                   | R1-webgl 33.4; R1-webgpu 17.0; R2-webgpu 17.0    |        1% | R1-webgl→R1-webgpu -49.1% A↓; R1-webgpu→R2-webgpu +0.0% noise; R1-webgl→R2-webgpu -49.1% A↓                       |
| fixture-alt               | interval p99 (ms)                   | R1-webgl 33.5; R1-webgpu 17.2; R2-webgpu 17.2    |        1% | R1-webgl→R1-webgpu -48.7% A↓; R1-webgpu→R2-webgpu -0.0% noise; R1-webgl→R2-webgpu -48.7% A↓                       |
| fixture-alt               | allocation MiB/s                    | R1-webgl 28.1; R1-webgpu 2.37; R2-webgpu 2.39    |        4% | R1-webgl→R1-webgpu -91.6% A↓; R1-webgpu→R2-webgpu +0.9% noise; R1-webgl→R2-webgpu -91.5% A↓                       |
| fixture-alt               | reclaimed MiB/s (lower-bound proxy) | R1-webgl 1.40; R1-webgpu 0.622; R2-webgpu 0.639  |       64% | R1-webgl→R1-webgpu -55.5% noise stop; R1-webgpu→R2-webgpu +2.7% noise; R1-webgl→R2-webgpu -54.3% noise stop       |
| fixture-alt               | dropped ticks                       | R1-webgl 0.000; R1-webgpu 0.000; R2-webgpu 0.000 |        0% | R1-webgl→R1-webgpu — noise; R1-webgpu→R2-webgpu — noise; R1-webgl→R2-webgpu — noise                               |
| rs-starfall60             | callback p50 (ms)                   | R0 4.60; R1 4.50; RS 4.70                        |       28% | R0→RS +2.2% noise stop; RS→R1 -4.3% noise; R0→R1 -2.2% noise stop                                                 |
| rs-starfall60             | callback p95 (ms)                   | R0 6.90; R1 6.90; RS 7.00                        |       19% | R0→RS +1.4% noise stop; RS→R1 -1.4% noise; R0→R1 +0.0% noise stop                                                 |
| rs-starfall60             | callback p99 (ms)                   | R0 8.20; R1 8.30; RS 8.60                        |       16% | R0→RS +4.9% noise stop; RS→R1 -3.5% noise; R0→R1 +1.2% noise stop                                                 |
| rs-starfall60             | interval p50 (ms)                   | R0 16.7; R1 16.7; RS 16.7                        |        0% | R0→RS +0.0% noise; RS→R1 +0.0% noise; R0→R1 +0.0% noise                                                           |
| rs-starfall60             | interval p95 (ms)                   | R0 17.0; R1 17.0; RS 17.0                        |        1% | R0→RS +0.0% noise; RS→R1 +0.0% noise; R0→R1 +0.0% noise                                                           |
| rs-starfall60             | interval p99 (ms)                   | R0 17.2; R1 17.2; RS 17.2                        |        1% | R0→RS +0.0% noise; RS→R1 +0.0% noise; R0→R1 +0.0% noise                                                           |
| rs-starfall60             | allocation MiB/s                    | R0 45.3; R1 35.0; RS 46.0                        |        1% | R0→RS +1.5% noise; RS→R1 -23.9% A↓; R0→R1 -22.8% A↓                                                               |
| rs-starfall60             | reclaimed MiB/s (lower-bound proxy) | R0 6.92; R1 2.53; RS 7.22                        |       11% | R0→RS +4.3% noise; RS→R1 -64.9% noise stop; R0→R1 -63.4% noise stop                                               |
| rs-starfall60             | dropped ticks                       | R0 0.000; R1 0.000; RS 0.000                     |        0% | R0→RS — noise; RS→R1 — noise; R0→R1 — noise                                                                       |
| rs-platformer60           | callback p50 (ms)                   | R0 0.800; R1 0.800; RS 0.800                     |        0% | R0→RS +0.0% noise; RS→R1 +0.0% noise; R0→R1 +0.0% noise                                                           |
| rs-platformer60           | callback p95 (ms)                   | R0 1.50; R1 1.40; RS 1.40                        |       21% | R0→RS -6.7% noise; RS→R1 -0.0% noise stop; R0→R1 -6.7% noise stop                                                 |
| rs-platformer60           | callback p99 (ms)                   | R0 1.80; R1 1.70; RS 1.70                        |       18% | R0→RS -5.6% noise stop; RS→R1 -0.0% noise stop; R0→R1 -5.6% noise stop                                            |
| rs-platformer60           | interval p50 (ms)                   | R0 16.7; R1 16.7; RS 16.7                        |        0% | R0→RS +0.0% noise; RS→R1 +0.0% noise; R0→R1 +0.0% noise                                                           |
| rs-platformer60           | interval p95 (ms)                   | R0 17.0; R1 17.0; RS 17.1                        |        1% | R0→RS +0.6% noise; RS→R1 -0.6% noise; R0→R1 +0.0% noise                                                           |
| rs-platformer60           | interval p99 (ms)                   | R0 17.2; R1 17.2; RS 17.2                        |        1% | R0→RS +0.0% noise; RS→R1 -0.0% noise; R0→R1 +0.0% noise                                                           |
| rs-platformer60           | allocation MiB/s                    | R0 0.659; R1 0.540; RS 0.647                     |        6% | R0→RS -1.8% noise; RS→R1 -16.6% A↓; R0→R1 -18.1% A↓                                                               |
| rs-platformer60           | reclaimed MiB/s (lower-bound proxy) | R0 0.511; R1 0.456; RS 0.517                     |        2% | R0→RS +1.1% noise; RS→R1 -11.7% A↓; R0→R1 -10.7% A↓                                                               |
| rs-platformer60           | dropped ticks                       | R0 0.000; R1 0.000; RS 0.000                     |        0% | R0→RS — noise; RS→R1 — noise; R0→R1 — noise                                                                       |

Fixture CPU preparation (0.1 ms timer quantum, noise stop in every alternating pair) and interval p50 (16.7 ms in every run) are in the phase 3 table. Units: churn time ms per commit; allocation sampled MiB per second; GC pause ms; fixture and RS rows as in phase 3.

#### Regression table

**No regression** under the predeclared rules: no decision metric is attributable up R0→R2 in any matrix. Leak: not assessable (confirmation waived; see gaps).

**Minor** (R0→R2 attributable up, below threshold): none.

**Pair-only increases** (attributable up on an intermediate pair while R0→R2 is not; not a regression by the rule):

- Chaos split (Node, ms per sample), W237 prepare p50, R1→R2 +2.6%
- Chaos split (Node, ms per sample), W237 sum p50, R1→R2 +4.0%
- Starfall Chaos Lab 60 s (browser), reclaimed MiB/s (lower-bound proxy), R1→R2 +212.9%

**Descriptive R0→R2 increases** (attributable by the same test, never a verdict):

- Starfall Chaos Lab 60 s (browser), retained after warmup (MiB): R0 5.05 → R2 6.53 (+29.2%)
- Platformer idle 60 s (browser), retained after warmup (MiB): R0 1.82 → R2 1.98 (+8.9%)
- Platformer idle 60 s (browser), retained after run (MiB): R0 2.01 → R2 2.09 (+4.0%)

#### Unresolved: noise-stopped R0→R2 at or above a threshold

The median change meets a regression threshold but a same-condition range exceeds 10%, so the rule gives no verdict. Reported with the observed ranges.

| Workload                          | Metric            |  R0→R2 | Threshold                            | Ranges                         | Runs separated  | Other pairs                                         |
| --------------------------------- | ----------------- | -----: | ------------------------------------ | ------------------------------ | --------------- | --------------------------------------------------- |
| Chaos split (Node, ms per sample) | W237 tick p95     | +26.9% | CPU p50/p95, attributable window +5% | R0 19%, RS 27%, R1 10%, R2 8%  | up, gap > range | R0→RS +4.1%; RS→R1 +2.4%; R1→R2 +19.1%; R0→R1 +6.6% |
| Chaos split (Node, ms per sample) | W237 sort p95     | +16.6% | CPU p50/p95, attributable window +5% | R0 25%, RS 13%, R1 51%, R2 32% | no              | R0→RS +4.0%; RS→R1 +3.0%; R1→R2 +8.9%; R0→R1 +7.1%  |
| Starfall Chaos Lab 60 s (browser) | callback p95 (ms) | +10.3% | browser callback p95 +10%            | R0 3%, R1 4%, R2 19%           | no              | R0→R1 -0.0%; R1→R2 +10.3%                           |

**Improvements R0→R2** (attributable down): Starfall Chaos Lab 60 s (browser) interval p99 (ms) -0.6%; Starfall Chaos Lab 60 s (browser) allocation MiB/s -61.3%; Platformer idle 60 s (browser) allocation MiB/s -8.0%; Platformer idle 60 s (browser) reclaimed MiB/s (lower-bound proxy) -15.6%.

<!-- ngne12:phase4:end -->

#### Rule check

A separate pass recomputed all 540 stored comparison verdicts (both analysis JSONs) from their run
values with the predeclared definitions: 0 mismatches. `phase3-analyze.mjs` does not store the
separation fields, so `phase4-report.mjs` recomputes them with the phase 2 definitions.

#### Unresolved candidates: attribution and cause evidence

None of these is a regression. Each is listed because its median meets a threshold, so a fix or an
accept decision needs it named. Confidence describes the evidence that a real R0→R2 increase exists.

| Candidate                                                   | Size (R0 → R2 medians)                 | Per-pair attribution (medians; all noise stop unless stated)                                                                               | Cause evidence                                                                                                                                                                                                                                                                                                                                                                               | Confidence                                                                                                                                 | Proposed fix direction                                                                                                                                          | Proposed closure target                                                                                                      |
| ----------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| U1. Chaos tick p95, `W` = 237 (Node)                        | 0.330 → 0.419 ms (+26.9%, +0.089 ms)   | R0→RS +4.1%, RS→R1 +2.4%, R1→R2 +19.1%. Most of the change sits at R1→R2.                                                                  | Every R2 run (0.401–0.436) is above every R0 run (0.322–0.385) and the gap exceeds both ranges; only R0's 19% range blocks attribution. Profile `diff-237-12b727e-86494fd`: new R2 keys `commitSceneSimulation` (`src/scene.ts:734`, 24.4 ms self), `demo/game.ts:557` (19.4), `:516` (17.2), `:371` (6.3); removed `:526` (-38.5), `:488` (-12.0). NGNE self total 96 → 99 ms.              | Medium for a real tail increase; low for the cause (profiles cover tick, preparation and sort together and do not isolate the tail ticks). | Session 2 investigation of per-commit work in the R2 Starfall systems (`commitSceneSimulation`, chunk callbacks); no code change is justified yet.              | Tick p95 inside `W` = 237 within the R0 run range (0.322–0.385 ms), with every condition's range at or below 10%.            |
| U2. Chaos sort p95, `W` = 237 (Node)                        | 0.098 → 0.115 ms (+16.6%, +0.016 ms)   | R0→RS +4.0%, RS→R1 +3.0%, R1→R2 +8.9%. Sort p99 rises at RS→R1 (+190%) and R1→R2 (+66%), also noise-stopped.                               | Runs overlap (R1 51%, R2 32% ranges). R1 widens `Frame` to 14 floats (NGNE-21); R2's browser allocation sites include `native sort <- quad-renderer.js:166 prepare` (8.8% of sampled bytes in the R2 run inspected). `Frame.sort` comparator lines moved between revisions, so profile keys do not pair.                                                                                     | Low.                                                                                                                                       | Session 2 investigation of the sort path (`Frame.sort`, comparator and its allocation); measure before changing.                                                | Sort p95 and p99 inside `W` = 237 within the R0 run ranges (p95 0.094–0.119 ms, p99 0.140–0.146 ms).                         |
| U3. Starfall callback p95, 60 s (browser)                   | 6.8 → 7.5 ms (+10.3%, +0.7 ms)         | R0→R1 0.0% (within run noise); R1→R2 +10.3%. RS submatrix: R0→RS +1.4%, RS→R1 -1.4%. The change sits at R1→R2 (game ports and WebGPU).     | R2 runs 6.3, 7.5, 7.7 ms against R0 6.7–6.9 (not separated; R2 range 19%); p50 +18.2% with R2 range 31%. Callback includes host DOM telemetry in every revision. R2 top allocation sites are `demo/game.ts` chunk callbacks (`:570`, `:516`, `:371`, `:557`, `:436`) and `createChunkDescriptor` (`dist/engine/ecs.js:537`), while total allocation fell 61%. No browser CPU profile exists. | Low: one R2 run is below every R0 run.                                                                                                     | Session 2 investigation of Starfall's R2 per-frame work (chunk callbacks, descriptor creation, WebGPU submission); a browser CPU profile would be needed first. | Callback p95 within the R0 run range (6.7–6.9 ms) with every condition's range at or below 10%; allocation not above R2.     |
| U4. Same-revision churn time (causal SoA, RS object→schema) | 0.344 → 2.638 ms per commit p50 (7.7×) | Not an R0→R2 pair. `churn-schema.ts` RS→R2 -1.6% (within run noise): the cost persists at R2. R0→R2 churn has no single matrix (see gaps). | Every schema run (2.595–2.663) is above every object run (0.327–0.367); object's 11.7% range triggers the noise stop. GC pause total 22.6 → 65.3 ms and count 30 → 79, both noise-stopped; bytes per commit 5.6× (descriptive), bytes per second -25% (attributable down).                                                                                                                   | High that schema structural churn costs more per commit than the object path at RS; not a regression verdict under the rule.               | Session 2 investigation of the schema spawn and despawn path (per-commit descriptors, spawn lowering), as the NGNE-27 lead suspected.                           | Schema commit p50 within a target the user sets (no R0 schema baseline exists); `churn-schema.ts` R2 range as the reference. |

Not listed: Chaos R1→R2 sum p50 +4.0% and preparation p50 +2.6% (attributable on that pair only, below
5%, and R0→R2 is within run noise), and Starfall R1→R2 reclaimed rate +213% (R1 is the low point; R0→R2
+4.3% within run noise).

#### Ranking

No regression exists, so the ranking orders the unresolved candidates for the phase 5 decision.

| Rank | Candidate | Frame-budget headroom (16.7 ms at 60 Hz)                                                                                                                                       | Memory over a 10-minute session                                                                                                                                                            |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | U3        | p95 callback 6.8 → 7.5 ms: headroom 9.9 → 9.2 ms (-0.7 ms, 4% of the budget); frame intervals unchanged, 0 dropped ticks                                                       | Allocation -61% (attributable down); reclaimed rate within run noise; retained after warmup +1.47 MiB (descriptive increase); no replicated retained-growth evidence (confirmation waived) |
| 2    | U4        | Not in the frame budget at current load (Starfall and the platformer do not churn at the measured rate); 2.3 ms more per commit at this churn rate would use 14% of the budget | Allocation per commit 5.6× (descriptive) but bytes per second lower; retained heap at end -1.1 MiB (descriptive); retained slope noise-stopped                                             |
| 3    | U1        | +0.089 ms per simulation tick at p95 (0.5% of the budget)                                                                                                                      | Not measured                                                                                                                                                                               |
| 4    | U2        | +0.016 ms per sort at p95 (0.1% of the budget)                                                                                                                                 | Not measured                                                                                                                                                                               |

Memory over 10 minutes, all workloads (descriptive, one run per revision for long and cycle runs):

- No replicated or confirmed retained-heap growth difference is established (confirmation waived); the single descriptive runs differ. `starfall300`: R0 4.76 → 5.93 MiB (leak candidate,
  unconfirmed), R2 6.50 → 5.50 MiB (unclassified). Cycles: Starfall growth 0.95 (R0) and 0.96 MiB (R2)
  over 40 cycles (about 7.5 minutes); platformer 0.67 and 0.71 MiB over 60 cycles (about 6.9 minutes).
- In these descriptive runs R2 shows an offset rather than extra growth: Starfall retained after warmup +1.47 MiB (5.05 → 6.53) and
  Starfall cycle checkpoints about +0.73 MiB throughout; platformer +0.16 MiB after warmup.
- Allocation churn falls: Starfall 45.6 → 17.7 MiB/s sampled (about 27 → 11 GiB over 10 minutes);
  platformer 0.63 → 0.58 MiB/s.

#### Evidence gaps (phase 5 must plan or waive each)

1. **GPU execution time:** not measured. The adapter exposes `timestamp-query`, but the engine requests
   no features (`src/gpu-context.ts`), so timing needs an engine change. GPU-side evidence is the
   renderer fixture (CPU preparation and submission) and the descriptive GPU-process trace.
2. **Leak confirmation:** `confirm-starfall300` waived. No leak or bounded-cache classification is
   replicated for any revision; "confirmed leak" is neither claimed nor excluded.
3. **Noise-stopped comparisons:** U1–U4 above, plus Chaos p99 rows, sort p99, churn p99 and GC pause
   totals, Starfall and platformer callback p50 and p99. Reported as narrowed, never as verdicts.
4. **Churn R0→R2:** no single matrix holds both (the object API is absent at R2, the schema API at R0),
   so structural churn has no whole-migration verdict; R0→RS and RS→R2 are measured separately and the
   storage change only by the RS causal matrix.
5. **Not comparable by design:** whole-run Chaos after tick 237 (play diverges); the renderer fixture
   has no R0 or RS; browser GC pauses exist only in descriptive traces.

#### Local limits (phase 4)

- One machine (Windows 11, i7-12650H, 16 GiB, mains power), one integrated GPU (Intel `gen-12lp`), one
  browser (Chrome 152 headful over CDP, DPR 1, 60 Hz), localhost production previews.
- Page timers are coarsened to 0.1 ms, so browser callback and fixture percentiles are quantised and
  small differences are unresolvable.
- Three or four runs per condition; allocation is sampled; reclaimed rate is a lower-bound proxy.
- At current load both games use about 1–9 ms of the 16.7 ms budget (callback p99), so frame-time differences do not
  reach dropped frames here. None of these results is a claim about other devices (NGNE-14).

#### Phase 4 inspection and checks

Codex `gpt-5.6-sol`, read-only, one session (`01a0ab0e-5960-73e1-8848-74a435ed6884`), 16 September
2026:

| Round | Verdict  | Findings and disposition                                                                                                                                                                        |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | REVISE   | 1 blocking: "no retained-heap growth difference is measured" overstated the waived-confirmation evidence. Fixed: no replicated or confirmed difference is established; offset scoped.           |
| 2     | REVISE   | 1 blocking: ranking memory cells still claimed absence. Fixed: U3 lists the attributable allocation drop, the descriptive retained increase and the waived confirmation; U1, U2 "Not measured". |
| 3     | APPROVED | None. Round 1 also confirmed plan hash, manifests, balanced blocks, no dropped runs, recorded deviations, phase 4 deliverables and protected paths.                                             |

Gate: `npm.cmd test` 141/141 pass; `typecheck`, `build`, `format` and `format:check` exit 0;
`git diff --check` empty; protected-path scan empty. Committed as S1-C1 `e5a9fb3` (not pushed).

### Decision (phase 5)

The user validated phase 4 and decided on 16 September 2026:

- **Fixes:** none selected. Unresolved candidates U1 (Chaos tick p95), U2 (Chaos sort p95), U3
  (Starfall callback p95) and U4 (same-revision schema churn time) are **accepted**. No session 2 plan
  is written.
- **Evidence gaps:** all five **waived**: GPU execution time, leak confirmation, noise-stopped
  comparisons, churn R0→R2 without a single matrix, and comparisons not possible by design.
- **Inspection:** the plan's Codex read-only inspection of this docs-only delta was **skipped by the
  user**.
- NGNE-12 is complete under the plan (no fixes selected, every gap waived). Jira is not updated from
  this session.

Gate (S1-C2): `npm.cmd test` 141/141 pass; `typecheck`, `build`, `format` and `format:check` exit 0;
`git diff --check` empty; protected-path scan empty.

## NGNE-27 — 13 September 2026

Migration of Starfall and the platformer to SoA and WebGPU, following the approved
[plan](../plans/NGNE-27-game-migration.md) (SHA256
`c65c44190c6f9d62f3b746e5d60d50f8ea171929cd4b12e91b5a96b8c14e3b01`) and
[handoff](../plans/NGNE-27-handoff.md). Complete: phases 0 (pre-migration baseline), 1 (NGNE-20
follow-ups), 2 (platformer port), 3 (Starfall port), 4 (WebGL and bridge removal), 5 (measurements,
final docs and inspection) and 6 ([deployment closeout](#deployment-phase-6)) validated.

### Pre-migration baseline and environment

Captured at HEAD `4760fe7e99b933f9927c647911ede7f8a9d6217e`. That commit differs from the
pre-build code revision `12b727e7f095a3ddd763724190a9d12ace6d2d76` only in `plans/NGNE-27-*`, so
every baseline below is code-identical to `12b727e`. The working tree was clean. Both games run on
the legacy object bridge and WebGL; hello runs on WebGPU.

- Windows 11 Home x64 10.0.26200; 12th Gen Intel Core i7-12650H, 10 cores / 16 logical, 16 GiB;
  Node v24.15.0, npm 11.12.1.
- In-app Chromium 152.0.7977.76; headful Chrome 152.0.7977.84; secure localhost; DPR 1.
- WebGPU adapter from `validation.html`: vendor `intel`, architecture `gen-12lp`,
  `isFallbackAdapter: false`, empty device/description; preferred `bgra8unorm`; maxBufferSize
  268435456, maxTextureDimension2D 8192. The headful WebGL baseline reports
  `ANGLE (Intel, Intel(R) UHD Graphics (0x000046A3) Direct3D11 vs_5_0 ps_5_0, D3D11)`.

Standard gate: `npm.cmd test` 134/134 pass; `typecheck`, `build`, `format:check` and
`git diff --check` pass. `validation.html` (dev server, trusted click) finished 182 PASS, 0 FAIL,
0 SKIP, `ALL CHECKS PASSED`, no console errors.

Raw diagnostics, scripts and revision exports are outside the checkout in
`C:/Users/jfabi/AppData/Local/Temp/ngne-27-diagnostics/`. They are local evidence, not portable
checked-in results. Manifest coverage is incomplete; see the provenance gap in the phase 5 record.

### CPU benchmark at HEAD

`npm.cmd run bench` twice, machine idle. CPU only; milliseconds.

| Run | ECS p50 | Chaos p50 | Chaos p95 | Peak sprites / slots | Ticks over budget | Grid legacy / schema p50 | Grid ratio |
| --- | ------- | --------- | --------- | -------------------- | ----------------- | ------------------------ | ---------- |
| 1   | 0.230   | 0.846     | 1.012     | 7,209 / 6,986        | 0                 | 1.092 / 1.183            | 1.083      |
| 2   | 0.218   | 0.843     | 1.086     | 7,209 / 6,986        | 0                 | 1.117 / 1.180            | 1.056      |

### Chaos attribution

Workload label: unchanged Starfall Chaos workload on the legacy object bridge. The script
`chaos-only.ts` (SHA256 prefix `66e2e84bbfc1`) was copied unchanged into `git archive` exports of
`a906f3a` (A, NGNE-20 base) and `9c00f02` (B, NGNE-20), each with `npm ci`. `demo/` is identical
between `a906f3a` and `12b727e`. Each run was a fresh process with no preceding ECS workload:
`arena({ stress: true })`, seed `bench`, 900 ticks of tick + render + sort at alpha 0.5, sample
indices 101–899 (799 samples). Order A B A B A B, machine idle.

| Revision    | p50 per run (ms)       | Median | Range  |
| ----------- | ---------------------- | ------ | ------ |
| A `a906f3a` | 0.6903, 0.6968, 0.6975 | 0.6968 | 0.0072 |
| B `9c00f02` | 0.7087, 0.7143, 0.7179 | 0.7143 | 0.0092 |

All runs: 7,209 peak sprites, 6,986 entity slots. Predeclared rule: attributable if every B p50
exceeds every A p50 and the B−A median gap exceeds the larger same-revision p50 range.
Both conditions hold: lowest B 0.7087 > highest A 0.6975, and gap 0.0175 ms (+2.5%) > 0.0092.
**Verdict: attributable to NGNE-20.** Profiling-level root cause remains with NGNE-12.

### Parity captures

Probe `parity-probe.ts` (SHA256 prefix `73e3f5de606e`) ran on the `12b727e` export, twice per run,
sampling tick 0 (after mount) and every committed tick. It hashes canonical JSON of `game.state`
and, per stack scene, id/definition/key/seed, resources, named RNG snapshots, camera and the sorted
per-composition multiset of `{ component: { field: value } }` tuples. Entity handles, rows and the
Starfall derived `collision-grid` resource are excluded. The order window `W` is the last committed
tick with every order-sensitive archetype at 512 live rows or fewer.

| Run                                                      | Ticks | `W`               | Two runs identical | Terminal                                                                                       | Hash-list SHA256 |
| -------------------------------------------------------- | ----- | ----------------- | ------------------ | ---------------------------------------------------------------------------------------------- | ---------------- |
| Platformer reference walkthrough                         | 1,448 | 1,448 (whole run) | Yes                | `platformer-complete`, 0 deaths, commands checkpoint 1, exit, checkpoint 1, checkpoint 2, exit | `b216e209…0615`  |
| Starfall normal (right 120, left 120, Space at tick 300) | 2,182 | 2,182 (whole run) | Yes                | `dead` at tick 2,182, score 55,350, 36.0 s                                                     | `19229bf9…7c67`  |
| Starfall Chaos                                           | 900   | 210               | Yes                | `playing`, score 274,800                                                                       | `05819083…8510`  |

The platformer capture includes the 25 hashes at ticks 0, 60, …, 1,440 for the phase 2 fixture.
Chaos `W` = 210 leaves about 110 samples (indices 101–209) in the phase 3–5 attributable A/B window.

### Sustained browser baseline

Production build (`npm.cmd run build`, `npm.cmd run preview`); headful Chrome through
`node --import tsx tests/browser-baseline.ts`; fresh launch per run; 10 s warmup, 60 s sample;
window visible and machine idle (user confirmed).

| Run                  | Visibility changes | Callback p50 / p99 ms | Interval p50 / p99 ms | >25 ms | Long tasks | Dropped ticks | Heap max MiB | Reclaimed MiB/s | Retained after GC MiB |
| -------------------- | ------------------ | --------------------- | --------------------- | ------ | ---------- | ------------- | ------------ | --------------- | --------------------- |
| Starfall Chaos Lab 1 | 0                  | 1.4 / 3.1             | 16.7 / 16.9           | 0      | 3          | 0             | 11.4         | 2.44            | 4.92 → 4.92           |
| Starfall Chaos Lab 2 | 0                  | 1.5 / 3.1             | 16.7 / 16.9           | 0      | 3          | 0             | 11.3         | 2.63            | 5.60 → 6.59           |
| Platformer idle 1    | 0                  | 0.2 / 0.4             | 16.7 / 17.0           | 0      | 2          | 0             | 3.4          | 0.45            | 1.92 → 2.12           |
| Platformer idle 2    | 0                  | 0.2 / 0.6             | 16.7 / 16.9           | 0      | 2          | 0             | 3.4          | 0.45            | 1.92 → 2.10           |

Starfall ended `CHAOS LAB / INVULNERABLE` with 6,626 sprites; the platformer ended on level 1 with
63 sprites. No page errors. The retained-heap rise in Starfall run 2 is recorded, not analysed
(NGNE-12).

### WebGL reference

Screenshots in headful Chrome 152.0.7977.84 on the dev server: Starfall attract, flight, result
(`SIGNAL LOST.`, 42 s, 67,200 points) and Chaos Lab; platformer level 1, pause, level 2 and
completion. There were no page errors, console errors or warnings. The result screen, level 2 and
completion were reached with a diagnostic input override: the capture script substituted the
`InputSnapshot` passed to `Game.prototype.tick`, and game code was unchanged.

User reference play on the production preview with sound on (Starfall flight and Chaos Lab;
platformer level 1): both games look as expected, music is audible and loops correctly, sound cues
line up with actions, and no issues were seen.

### NGNE-20 follow-ups (phase 1)

Focused tests added to `tests/ecs-soa.test.ts`; `npm.cmd test` 138/138 (phase 0 count + 4):

- Same-query nesting over 600 rows (chunks of 512 and 88) visits the chunk cross product
  `[512,512], [512,88], [88,512], [88,88]`, with outer and each inner traversal in creation/chunk/row order.
- `commit()` inside the inner callback of a same-query nested pair throws, it still throws in the
  outer callback, and it succeeds after both return.
- `entityAt(row)` returns the `===` handle from `spawn()` for rows in both chunks. After a committed
  swap removal in each chunk, row 0 returns the moved entity's same canonical handle.
- `Game.enumerate()` field records for null, live and stale (despawned and committed) references
  equal `{ name: "target", kind: "entity", value }` exactly, with `value` `null` or
  `{ index, generation }`. The target slot records show `pending: false` with row 0 (live) and
  `generation + 1`, row −1 on the free stack (stale).

Per-commit-epoch descriptor cost, included rather than deferred. `commit()` increments the borrow
epoch unconditionally (`src/ecs.ts`, `World.commit`), so a commit without membership change forces
descriptor reconstruction on the next typed traversal. New `epochTraversal` arm in
`tests/benchmark.ts` on the 20,000-entity typed pass (40 chunks). It runs after all other
sections: 100 warmup and 300 samples of a separately timed no-op commit, traversal 1 (first in the
new epoch) and identical traversal 2. Two runs with manifests; milliseconds:

| Run | Commit p50 | Traversal 1 p50 / p95 | Traversal 2 p50 / p95 | Paired delta p50 / p95 | Delta mean |
| --- | ---------- | --------------------- | --------------------- | ---------------------- | ---------- |
| 1   | 0.0004     | 0.392 / 0.486         | 0.218 / 0.278         | 0.172 / 0.270          | 0.193      |
| 2   | 0.0004     | 0.393 / 0.457         | 0.219 / 0.253         | 0.173 / 0.230          | 0.198      |

The first traversal after a commit costs about 0.17 ms more on this workload, about 4 µs per chunk
descriptor. That is roughly 1.8 times the same-epoch traversal. The measurement does not separate
descriptor construction from inline-cache effects on the fresh descriptor objects. Migrated
Starfall commits every tick, so phase 3 evidence includes this cost in its whole-game timings.

Existing bench sections in the same two runs, compared with the phase 0 ranges:

| Metric          | Phase 0 range | Phase 1 runs | Difference                             |
| --------------- | ------------- | ------------ | -------------------------------------- |
| ECS p50         | 0.218–0.230   | 0.223, 0.222 | Within range                           |
| Chaos p50       | 0.843–0.846   | 0.836, 0.832 | Both below range, by up to 1.3% faster |
| Chaos p95       | 1.012–1.086   | 1.058, 0.976 | Run 2 below range                      |
| Grid legacy p50 | 1.092–1.117   | 1.093, 1.075 | Run 2 below range                      |
| Grid schema p50 | 1.180–1.183   | 1.170, 1.201 | Run 1 below, run 2 above (≤1.5%)       |
| Grid ratio      | 1.056–1.083   | 1.071, 1.118 | Run 2 above range                      |

The sections before the new arm are unchanged code, and the new arm runs after them. The
differences are small and in both directions, consistent with run noise. No bench output shape
changed besides the added `epochTraversal` key.

The contract ownership inventory rows "ECS values and identity" and "Allocator and iteration
history" now name schema chunk creation and lowest-chunk reuse order, `chunk` plus chunk-relative
`row` locations, field-record inspection, immutable schema definitions with frozen field descriptors,
and per-epoch descriptor borrowing. Legacy text stays until phase 4.

### Platformer on schema ECS and WebGPU (phase 2)

`examples/platformer/game.ts` uses schema components: `position` and `body` fields are `f64`,
`grounded` is `bool`, `actor.kind` is `u8` and `facing` is `f64`. Traversal uses `eachChunk`, and
each system locates the player's views and row from its canonical handle. `main.ts` opts into
`renderer: "webgpu"` and accumulates hello-style diagnostics. No `src/` file changed; migration
friction is recorded in [the platformer findings](../examples/platformer/FINDINGS.md).

- Parity: the unchanged phase 0 probe on the working tree reproduced all 1,449 canonical hashes
  (ticks 0–1,448) exactly. Hash-list SHA256 is `b216e209…0615`, as before. Two consecutive runs were
  identical, `W` covers the whole run, and the walkthrough had 0 deaths with the same five commands.
- `tests/platformer.test.ts` reads schema field records. A new test recomputes the canonical hash
  at ticks 0, 60, …, 1,440 and matches the 25 embedded phase 0 values.
- Gate: `npm.cmd test` 139/139; `typecheck`, `build`, `format:check` and `git diff --check` pass;
  the A1 import scan returns nothing.
- `validation.html` on the dev server in the in-app Chromium: 184 PASS (phase 1 count + 2), 0 FAIL,
  0 SKIP, `ALL CHECKS PASSED`, no console errors. The two additions come from the new
  `tests/browser-game-checks.ts` platformer fixture. It replaces `navigator.gpu` so the adapter
  request resolves `null`, then waits for a trusted click on the fixture's Start button. It checks
  that `WebGPU adapter unavailable. Enable browser hardware acceleration` is still shown after 500 ms,
  that Start is unavailable, and that the page shows `Unable to continue`.

Browser replay, driven by the executor: the in-app Browser pane was hidden, so its
`requestAnimationFrame` did not run. The replay therefore ran in headful Chrome 152.0.7977.84 over
CDP on the dev server. Keys were trusted `Input.dispatchKeyEvent` events, buttons were clicked with a
user gesture, and state was read from a diagnostic `Game.prototype.tick` hook that never changes
input. Chrome ran with occlusion and background throttling disabled; this was a functional replay,
not a measurement. All 15 cases passed on WebGPU with no console errors or warnings:

- Start: level 1 runs, the WebGPU canvas context is present and the canvas has focus.
- Movement: holding right moved the player 278 px, Space reached vy −273, and the camera followed.
- Pause and resume by P, by Escape and by the button. While paused, the overlay scene was pushed,
  lower-scene poses and camera were identical after 67 further ticks, and canvas screenshots were
  byte-identical.
- NGNE-9 game flow: P pause then button resume, with focus returning to the canvas.
- NGNE-10 step 5: three pause/resume cycles with no error UI or console error.
- A hazard death before the first checkpoint remounted `level-0-attempt-1` at the start position.
- Holding right with scripted jumps (trusted keys) reached level 2 and then the completion overlay
  (`Game complete`, `Play again`) with no further deaths. Enter restarted a fresh level 1 run
  (`runs: 1`).

Screenshots of level 1, pause, level 2, completion and restart match the phase 0 WebGL references in
layout, colours and pause dimming. Physical keyboard, audio, tab switching and a post-checkpoint
death remount are the user's manual checks.

`MANUAL (user)`: the user confirmed all phase 2 manual checks pass (physical keyboard through both
levels, pause/resume and tab switching, audio). Gamepad: untested (no device).

### Starfall on schema ECS and WebGPU (phase 3)

`demo/game.ts` uses schema components:

- `position`: `x`, `y`, `px`, `py` are `f64`.
- `body`: `vx`, `vy`, `radius`, `hp`, `age`, `cooldown` are `f64`; `active` is `bool`; `kind` is `u8`.
- `visual`: `sprite` is `u8`; `size`, `angle` are `f64`.
- `particle`: `vx`, `vy`, `life`, `maxLife`, `size` are `f64`; `color` is `u32`.

Traversal uses `eachChunk`, with `chunk.count` read once per chunk. The player's views and row are
located per update from its handle.

The `collision-grid` resource holds `{ e, p, b, row }` entries: entity handle, borrowed `position` and
`body` chunk views, and chunk-relative row. Lines `for (const cell of grid) cell.length = 0` and the
movement traversal that pushes entries run, in that order, before the collision traversal reads the
grid in the same system call. No commit occurs between build and probe.

The particle update is unchanged in substance: each row updates independently, draws no RNG and
reads no other entity. `demo/main.ts` changes:

- The atlas is an `ImageAsset` decoded with `createImageBitmap` (`premultiplyAlpha` and
  `colorSpaceConversion` set to `"none"`) and closed on dispose; the manual texture upload is gone.
- `renderer: "webgpu"` is set.
- Hello-style accumulated diagnostics replace the overwrite-only error text.
- A boot failure reports `Unable to start Starfall. It requires WebGPU with hardware acceleration`
  with its cause.
- The host is disposed on `pagehide`.

No `src/` file changed.

Parity and determinism, using the phase 0 probe unchanged on the working tree:

| Run             | `W` (migrated) | Hashes vs phase 0                                               | Two migrated runs | Terminal (pre / migrated)                         |
| --------------- | -------------- | --------------------------------------------------------------- | ----------------- | ------------------------------------------------- |
| Starfall normal | 2,182          | All 2,183 identical (ticks 0–2,182)                             | Identical         | `dead` at 2,182, score 55,350 / identical         |
| Starfall Chaos  | 210            | Identical at every tick up to 237; first difference at tick 238 | Identical         | tick 900, score 274,800 / tick 900, score 280,400 |

Chaos stays exact beyond its order window of 210 and diverges only after it, as the chunk-order
rule allows.

Chaos-only migration A/B: the unchanged `chaos-only.ts --window 210` ran fresh per run, order P M P M
P M, with P the `12b727e` export and M the working tree. The attributable window is sample indices
101–209 (109 samples); medians in ms:

| Attempt                               | P p50 per run          | M p50 per run          | Window P / M median | Window M/P | Whole-run P / M median |
| ------------------------------------- | ---------------------- | ---------------------- | ------------------- | ---------- | ---------------------- |
| 1 (initial port)                      | 0.7102, 0.7477, 0.7421 | 0.9269, 0.9376, 0.9207 | 0.7421 / 0.9269     | **1.249**  | 0.7341 / 0.8655        |
| 2 (`chunk.count` read once per chunk) | 0.7565, 0.7541, 0.7597 | 0.8666, 0.7979, 0.8095 | 0.7565 / 0.8095     | **1.070**  | 0.7327 / 0.7286        |

Attempt 1 exceeded the plan's 20% stop trigger. The work stopped and was reported with a CPU profile
(`--cpu-prof`, 900 ticks including setup), which attributed the added self time to four areas:

- per-commit chunk descriptor reconstruction, `createChunkDescriptor` at 69 ms;
- commit bookkeeping, `commit` at 52 ms versus 3.5 ms before;
- borrow-checked accessor calls, `get` at 47 ms;
- schema spawn validation and column writes, `lowerSchemaValue` and `commitSchemaBirth` at 82 ms.

`eachChunk` traversal took 30 ms against 63 ms for legacy `each`.

With the user's approval, attempt 2 read `chunk.count` once per chunk in every Starfall row loop.
Migrated hashes stayed identical to attempt 1. The remaining +7.0% in the attributable window is within
the trigger. It is recorded as the SoA cost for this workload (descriptor reconstruction, commit and
spawn validation); profiling-level root cause stays with NGNE-12. Whole-run medians include gameplay
divergence after tick 238 and are not attributable.

Gate and tests: `npm.cmd test` 140/140 (phase 2 count + 1), with `typecheck`, `build`, `format:check`
and `git diff --check` all passing. The A1 import scan returns nothing. The new
`tests/game.test.ts` test gives arena setup a fake decoded atlas object: setup receives that same
object from the loader, the resources are exactly `run`, `stars`, `collision-grid` and `player`, every
archetype field kind is `f64`, `u8`, `u32` or `bool`, and the atlas is loaded once and disposed once.

`npm.cmd run bench` twice with manifests, milliseconds. The Chaos section now runs migrated Starfall,
and its population diverges from phase 0 after tick 238.

| Run | ECS p50 | Chaos p50 / p95 | Peak sprites / slots | Grid legacy / schema p50 | Epoch traversal 1 / 2 p50 | Paired delta p50 |
| --- | ------- | --------------- | -------------------- | ------------------------ | ------------------------- | ---------------- |
| 1   | 0.234   | 0.752 / 1.082   | 7,211 / 6,988        | 1.076 / 1.074            | 0.414 / 0.232             | 0.182            |
| 2   | 0.240   | 0.714 / 0.936   | 7,211 / 6,988        | 1.073 / 1.112            | 0.420 / 0.233             | 0.184            |

`validation.html` in the in-app Chromium (dev server): 191 PASS (phase 2 count + 7), 0 FAIL, 0 SKIP,
`ALL CHECKS PASSED`, no console errors. The additions are in `tests/browser-game-checks.ts`:

- A WebGPU `BrowserGame` running Starfall's arena with a counting atlas `ImageAsset`, one start and
  three `set` replacements through fresh `prepare` calls, drives frames from a manual scheduler.
  Wrapping the instance's public `assets.acquire` observed the scene lease and the host's renderer
  source lease separately: one of each per preparation, in that order.
- After the start and after each replacement: exactly one scene lease and one renderer source lease are
  live; the atlas has loaded once and been disposed zero times; and 9/9 sampled canvas pixels at the
  player's centre match opaque atlas ship-cell colours, read back with `drawImage` from the presented
  WebGPU canvas.
- After `app.dispose()`: the atlas is disposed exactly once and all 4 scene and 4 source leases are
  released.
- A Starfall unsupported fixture (null adapter, no click) keeps both
  `Unable to start Starfall. It requires WebGPU with hardware acceleration` and
  `WebGPU adapter unavailable. Enable browser hardware acceleration` after 500 ms, with
  `UNABLE TO START`.

Browser replay, driven by the executor with the same method as phase 2 (headful Chrome 152.0.7977.84
over CDP on the dev server, trusted keys, user-gesture clicks, a non-substituting state hook,
occlusion throttling disabled). All 11 cases passed with no console errors or warnings:

- Attract mode ran on WebGPU with `RUNNING`.
- NGNE-10 step 4: Sound off to on.
- Start Flight ran the normal arena with canvas focus.
- NGNE-9 game flow: P shows `FLIGHT PAUSED` and the arena `run` resource stayed frozen; button resume
  shows `FLIGHT IN PROGRESS` with canvas focus. Escape also paused and resumed.
- One normal flight without further input ended with `SIGNAL LOST.` at 39.05 s and 65,200 points.
  `game.state` became `runs: 1`, `best` and `lastScore` 65,200, and the HUD showed best `065200`.
- **Fly again** started `run-1-normal` and kept the best score.
- Chaos Lab launched three times showed `CHAOS LAB / INVULNERABLE` on `run-1-chaos` without error UI.

On the dev server after the three Chaos launches, the HUD showed `17 TICKS DROPPED`. This replay does
not measure performance; production sustained runs are phase 5 evidence. Screenshots of attract,
flight, pause, result and Chaos Lab match the phase 0 WebGL references in atlas cells, colours, alpha
and backdrop.

Friction, all expressible with supported API:

- `chunk.count` is a borrow-checked accessor, so reading it in a row-loop condition costs a checked
  call per row. That was most of the attempt 1 regression; reading it once per chunk is the idiomatic
  fix. The guide should say so in phase 5.
- As in the platformer, there is no handle-to-row view lookup, so the player's row is found by
  scanning with `entityAt`.
- Image preparation failures reach the page wrapped in `Scene preparation failed`
  (`AggregateError`); hello-style flattening shows the capability message beneath it.

`MANUAL (user)`: the user confirmed all phase 3 manual checks pass (keyboard and mouse, a full flight
with **Fly again**, visuals, audio). Touch and gamepad: untested (no device).

### WebGL and object-bridge removal (phase 4)

Code at HEAD `54bc67a` (phases 0–3 committed) plus the phase 4 working tree:

- `src/renderer.ts` keeps `Sprite`, `Frame` and `packAffine` and deletes the WebGL `Renderer` and its
  shaders. `git diff 12b727e -- src/renderer.ts` is a single hunk that removes the 222 lines after
  `packAffine` and adds none.
- `src/index.ts` exports `Frame` and the `Sprite` type by name and no longer exports `Component`,
  `ComponentValue` or `Query`.
- `src/browser.ts` has no `renderer` option or WebGL branches. `BrowserGame.renderer` is
  `WebGPURenderer | undefined`, and every host path uses the former WebGPU preparation, startup,
  rollback, stop and frame-failure teardown.
- `src/ecs.ts` removes the factory overload, object columns, `get`, `Query.each`, the legacy
  archetype/query runtime, mixed-mode checks and legacy enumeration. Empty `spawn()` now creates the
  schema archetype with no components, and zero-argument `query()` remains. Unchecked JavaScript that
  passes a factory function to `component()` or a non-schema value to `spawn`/`query` now throws
  (`Component fields must be a schema object`, `Schema component required`) instead of silently
  creating an empty schema or failing later with a `TypeError`.
- Hello and both games drop `renderer: "webgpu"`; no other game code changed.

Tests:

- `engine.test.ts`, `simulation.contract.test.ts` and `ownership.test.ts` use schema components with
  `eachChunk`, reading `chunk.count` once per chunk, and sparse `read`. Every asserted behaviour is
  preserved. Inspection assertions now expect schema field records and the archetype
  `fields`/`chunks` shape.
- In `ecs-soa.test.ts`, legacy entities used as ordering and allocation fixtures became schema
  entities. The mixed-mode test is split into "world access and query runtimes stay opaque and reject
  unchecked callers" and "disposal invalidates queries and chunk borrows". Only mixed-mode and legacy
  assertions were deleted; new assertions cover the unchecked-caller rejections. The live reference
  target slot record gains `chunk: 0`, because empty spawns are now schema entities.
- `api-misuse.ts` adds `@ts-expect-error` cases for the factory overload, `get`, `each`, the removed
  `Component`/`ComponentValue`/`Query` types, a `renderer` option and `Renderer`. The option case uses
  the value `"auto"`: an excess `renderer` property fails with any value, and the literal
  `renderer: "webgpu"` would match the phase 4 source scan.
- Browser tests: the eight WebGL/context-loss checks are deleted. Lifecycle and input checks run once
  on the WebGPU host, not twice. Interpolation checks are WebGPU only, with one check per sample.
  `browser-renderer-benchmark.ts` has no `webgl` mode. `browser-baseline.ts` reports WebGPU adapter
  info. The `validation.html` copy and fixture canvas were updated.
- `tests/benchmark.ts` no longer has the legacy collision-grid arm, so the `collisionGrid` result no
  longer has `legacyObject` or `medianRatio`.

Gate:

- `npm.cmd test`: 141/141. Phase 3 had 140; the split test adds one.
- `typecheck`, `build` (library, API fixture against emitted declarations, three Vite entries),
  `format:check` and `git diff --check` all pass.
- The A1 import scan and phase 4 entry scan return nothing.
- The phase 4 WebGL scan returns nothing when run in Git Bash. In Windows PowerShell 5.1 the embedded
  double quotes in `'webgl|renderer: "webgpu"'` are stripped before `git grep` receives the pattern.
  It then matches two `renderer: WebGPURenderer` / `canvasRenderer: WebGPURenderer` type
  annotations; neither contains `webgl` or the option.
- Before editing, the scan listed:
    - the WebGL `Renderer` in `src/renderer.ts`;
    - WebGL test code in `browser-validation.ts`, `browser-interpolation-checks.ts`,
      `browser-renderer-benchmark.ts` and `browser-baseline.ts`;
    - the `browser-webgpu-checks.ts` comment;
    - `validation.html` copy;
    - README, guide, `ngne.svg`, the platformer findings and `index.html` text;
    - ten `renderer: "webgpu"` options in games, hello, the guide and browser tests.

Parity after the removal, using the unchanged phase 0 probe: the platformer, Starfall normal and
Starfall Chaos hash lists are identical to their phase 2/3 values (`b216e209…`, `19229bf9…`,
`969b0e59…`). `W` stayed 1,448, 2,182 and 210, terminal outcomes did not change, and two runs of each
were identical.

`npm.cmd run bench` twice with manifests, milliseconds:

| Run | ECS p50 | Chaos p50 / p95 | Peak sprites / slots | Grid schema p50 | Epoch traversal 1 / 2 p50 | Paired delta p50 |
| --- | ------- | --------------- | -------------------- | --------------- | ------------------------- | ---------------- |
| 1   | 0.237   | 0.734 / 0.965   | 7,211 / 6,988        | 1.239           | 0.450 / 0.250             | 0.197            |
| 2   | 0.239   | 0.737 / 0.964   | 7,211 / 6,988        | 1.254           | 0.417 / 0.233             | 0.183            |

ECS, Chaos and epoch medians are within or near the phase 3 runs. The schema grid arm is about 13%
slower than in phase 3 (1.074, 1.112). Its code is unchanged, but it now runs directly after the
Chaos section instead of after the deleted legacy arm, so warm state differs. The cause is not
isolated.

Chaos-only A/B with the unchanged `chaos-only.ts --window 210`, fresh process per run, order
P M P M P M (P the `12b727e` export, M the phase 4 working tree); medians in ms:

| Window                               | P p50 per run          | M p50 per run          | P / M median    | M/P       |
| ------------------------------------ | ---------------------- | ---------------------- | --------------- | --------- |
| Attributable, indices 101–209 (109)  | 0.7345, 0.7635, 0.7604 | 0.8332, 0.8360, 0.8604 | 0.7604 / 0.8360 | **1.099** |
| Whole run 101–899 (non-attributable) | 0.7523, 0.7414, 0.7419 | 0.7297, 0.7374, 0.7452 | 0.7419 / 0.7374 | 0.994     |

The attributable ratio is within the 20% stop trigger; phase 3 attempt 2 measured 1.070. Peak
sprites/slots: P 7,209 / 6,986, M 7,211 / 6,988.

Browser validation. The in-app Browser pane stopped drawing while hidden (screenshots timed out), and
the first run's fixture click missed. Validation therefore ran in headful Chrome 152.0.7977.84 over
CDP on the dev server (driver `validation-cdp.mts`). Both required clicks, **Run checks** and the
platformer fixture's **Start level 1**, were trusted `Input.dispatchMouseEvent` presses.

- Result: 153 PASS, 0 FAIL, 0 SKIP, `ALL CHECKS PASSED`, no console errors or warnings. Adapter
  `intel` / `gen-12lp`, `bgra8unorm`.
- Phase 3 had 191. The 38 removed checks are:
    - 8 WebGL checks (layer order, scene order, alpha, texture sampling, 10,000-sprite draw, GL error,
      context loss, context restoration); WebGPU core and recovery checks already cover the same
      behaviours;
    - 14 lifecycle and 15 input checks from the former WebGL-host runs, which still run on WebGPU;
    - 1 aggregate WebGPU interpolation check, now replaced by the 65 per-sample WebGPU checks that
      previously ran on WebGL.
- The Starfall and platformer unsupported fixtures pass.

Production build (`npm.cmd run build`, `npm.cmd run preview`) in headful Chrome over CDP (driver
`preview-check.mts`):

- Starfall attract mode ran on WebGPU with `RUNNING` and changing presented frames. Start Flight
  showed `FLIGHT IN PROGRESS` with no error UI; the HUD showed `14 TICKS DROPPED` after the start
  transition, which this check does not measure.
- Hello ran on WebGPU with a moving sprite.
- Platformer level 1 started from a trusted Start click and the frame changed while holding right.
- All three pages had no console errors, warnings or exceptions. The footer now reads `INSTANCED
WEBGPU`.

Documentation: the contract has migration notes for the bridge, option and `Renderer` removals and
the empty-entity inspection shape, and an updated public symbol table. Guide, README, `ngne.svg`,
decisions and roadmap were updated; the roadmap marks the removal done with deployment pending.
`docs/architecture.md` needed no change.

`MANUAL (user)`:

- Production preview play: both games behave as in phases 2 and 3.
- The user noticed that platformer music, while looping correctly, starts late.
- In Chrome with `--disable-gpu`, `await navigator.gpu?.requestAdapter()` still returned an adapter,
  so the unsupported-environment check is not reproducible on this machine. The automated
  unsupported fixtures remain the evidence.

Platformer audio-latency probe (driver `platformer-audio-latency.mts`, headful Chrome over CDP, dev
servers, 5 fresh page loads per tree, trusted Start click and Space presses):

| Tree              | Start click → looping music start (ms) | Space → jump cue start (ms) |
| ----------------- | -------------------------------------- | --------------------------- |
| `12b727e` (WebGL) | 100, 50, 49, 65, 67                    | 14–33, typically 15         |
| Phase 4 (WebGPU)  | 1,127, 950, 933, 949, 934              | 12–30, typically 15         |

Cues during play are unchanged. The start delay is renderer acquisition. The platformer has no image
assets, so preparation never creates the renderer, and `app.start()` acquires it before mounting and
scheduling the first tick that queues the music. A second probe timed the first `requestAdapter()` at
969 and 757 ms, `requestDevice()` at 123 and 90 ms and pipeline creation at 26 and 1 ms. Starfall is
unaffected at Start because preparing its atlas acquires the renderer at boot. No supported API
acquires the renderer ahead of `start()` without an image asset. The finding is recorded as
[platformer finding 15](../examples/platformer/FINDINGS.md). The user accepted the delay for NGNE-27 and
left finding 15 open; no engine change was made. Phase 4 validated by the user.

### Post-migration measurements (phase 5)

Workload label for every comparison below: whole-stack change (schema SoA ECS, WebGPU renderer,
and the removal of WebGL and the object bridge), not attributable to any one of them. Same machine,
Chrome 152.0.7977.84, Node v24.15.0. The WebGPU adapter is `intel` / `gen-12lp`, as recorded by
`browser-baseline.ts`.

Sustained browser runs used the phase 0 method: production build, `npm.cmd run preview`, headful
Chrome via `node --import tsx tests/browser-baseline.ts`, fresh launch per run, 10 s warmup and 60 s
sample. The window stayed visible and the machine idle (user confirmed). All four runs recorded 0
visibility changes, 0 intervals over 25 ms, 0 ticks dropped during the sample, no page errors and an
empty stderr.

| Run                  | Callback p50 / p99 ms (pre → post) | Interval p50 / p99 ms (pre → post) | Long tasks | Heap max MiB | Reclaimed MiB/s | Retained after GC MiB (post) |
| -------------------- | ---------------------------------- | ---------------------------------- | ---------- | ------------ | --------------- | ---------------------------- |
| Starfall Chaos Lab 1 | 1.4 / 3.1 → 1.3 / 3.3              | 16.7 / 16.9 → 16.7 / 16.9          | 3 → 2      | 11.4 → 17.7  | 2.44 → 7.86     | 4.52 → 6.40                  |
| Starfall Chaos Lab 2 | 1.5 / 3.1 → 1.4 / 3.4              | 16.7 / 16.9 → 16.7 / 16.9          | 3 → 2      | 11.3 → 17.7  | 2.63 → 7.63     | 4.51 → 6.36                  |
| Platformer idle 1    | 0.2 / 0.4 → 0.3 / 0.7              | 16.7 / 17.0 → 16.7 / 16.9          | 2 → 1      | 3.4 → 3.3    | 0.45 → 0.43     | 1.88 → 2.00                  |
| Platformer idle 2    | 0.2 / 0.6 → 0.3 / 0.8              | 16.7 / 16.9 → 16.7 / 16.9          | 2 → 1      | 3.4 → 3.3    | 0.45 → 0.44     | 1.90 → 2.00                  |

Starfall still ends `CHAOS LAB / INVULNERABLE`, now with 6,558 and 6,568 sprites against 6,626 before,
and the platformer ends on level 1 with 63 sprites. Frame pacing is unchanged at 60 Hz. The Starfall
Chaos garbage rate is about three times the pre-migration rate (heap max 17.7 against 11.4 MiB) and
the retained heap after forced GC rises by about 1.9 MiB during each run. Plausible sources are the
per-commit chunk descriptors and schema spawn lowering, but they are not isolated. Analysis belongs to
NGNE-12.

`npm.cmd run bench` twice with manifests, milliseconds:

| Run | ECS p50 | Chaos p50 / p95 | Peak sprites / slots | Grid schema p50 | Epoch traversal 1 / 2 p50 | Paired delta p50 / p95 | No-op commit p50 |
| --- | ------- | --------------- | -------------------- | --------------- | ------------------------- | ---------------------- | ---------------- |
| 1   | 0.245   | 0.737 / 0.982   | 7,211 / 6,988        | 1.216           | 0.422 / 0.235             | 0.187 / 0.243          | 0.0004           |
| 2   | 0.244   | 0.741 / 0.993   | 7,211 / 6,988        | 1.218           | 0.424 / 0.236             | 0.186 / 0.251          | 0.0004           |

Final Chaos-only A/B with the unchanged `chaos-only.ts --window 210`, fresh process per run, order
P M P M P M (P the `12b727e` export, M the phase 5 working tree). Attributable window P p50 0.7794,
0.7434, 0.7672 and M 0.8564, 0.8705, 0.8585. Whole run P 0.7441, 0.7372, 0.7572 and M 0.7499, 0.7630,
0.7345.

Final comparison. Chaos label: Starfall Chaos Lab, seed `bench`, 900 ticks, CPU-only tick + render +
sort at alpha 0.5, samples 101–899, no GPU; identical `Frame` code in both arms. The runtime variable is
Starfall on schema ECS (post) versus the legacy object bridge (pre), including gameplay divergence after
the order window.

| Stage                      | Bench ECS p50 | Bench Chaos p50 | Chaos-only window M/P (109 samples) | Chaos-only whole-run M/P | Epoch paired delta p50 |
| -------------------------- | ------------- | --------------- | ----------------------------------- | ------------------------ | ---------------------- |
| Pre-build (phase 0, WebGL) | 0.230, 0.218  | 0.846, 0.843    | —                                   | —                        | not measured           |
| Phase 3 (attempt 2)        | 0.234, 0.240  | 0.752, 0.714    | 1.070                               | 0.994                    | 0.182, 0.184           |
| Phase 4                    | 0.237, 0.239  | 0.734, 0.737    | 1.099                               | 0.994                    | 0.197, 0.183           |
| Final (phase 5)            | 0.245, 0.244  | 0.737, 0.741    | 1.119                               | 1.008                    | 0.187, 0.186           |

The bench Chaos section is not an A/B: its pre-build runs ran on the legacy bridge with a preceding ECS
workload in the same process. The Chaos-only A/B is the comparison for the migration. Within the
attributable window, migrated Starfall is 7–12% slower per tick than the legacy bridge across phases
3–5, all inside the 20% stop trigger. Across the whole 900-tick run the medians are equal within
noise, with the divergent populations noted above.

### Verification record

- Environment: Windows 11 Home 10.0.26200, Intel Core i7-12650H, Node v24.15.0, npm 11.12.1, in-app
  Chromium 152.0.7977.76, headful Chrome 152.0.7977.84, secure localhost, DPR 1. WebGPU adapter
  `intel` / `gen-12lp`, `bgra8unorm`.
- Chaos attribution: the NGNE-20 delta on the unchanged Starfall Chaos workload on the legacy object
  bridge is attributable to NGNE-20 (+2.5%, phase 0).
- Per-commit-epoch descriptor cost: included, not deferred. It is about 0.18–0.20 ms per 40-chunk
  traversal (about 4–5 µs per chunk) and has been stable from phase 1 to phase 5. Migrated Starfall
  commits every tick, so the whole-game timings above include it.
- Friction:
    - `chunk.count` must be read once per chunk; the guide now says so.
    - There is no handle-to-row view lookup, so the player row is found by scanning with `entityAt`.
    - Pending spawn values cannot be read in setup.
    - `bool` view columns are `Uint8Array`.
    - A `let` initialized to `undefined` and assigned only inside a visitor is narrowed to `undefined`
      after the call; declaring it without an initializer avoids a type assertion.
    - Image preparation failures arrive wrapped in `AggregateError`.
    - The unsupported platformer fixture needs trusted input.
    - Open: platformer music starts late because the renderer is first acquired at Start (platformer
      finding 15, accepted by the user).
- Remaining limits:
    - One GPU and driver only (Intel `gen-12lp`); no portability claim (NGNE-14).
    - Gamepad and touch are untested (no device).
    - `--disable-gpu` Chrome still exposed an adapter, so the unsupported path is covered only by the
      automated null-adapter fixtures.
    - Browser replays and validation ran in headful Chrome over CDP because the hidden in-app pane does
      not draw.
    - The Starfall allocation rate and retained-heap growth are recorded but not analysed (NGNE-12).
    - NGNE-21 limits carry forward: image candidate refill, general host-hook lease counts and loss
      during replacement awaits.
- Provenance gap: bench, sustained-run and Chaos-only A/B results from every phase, and the phase 4
  and phase 5 parity, validation and preview results, have manifest sidecars. The phase 0–3 parity
  captures (`platformer*.json`, `starfall-*.json`, `*-phase3*.json`), the phase 2/3 replay JSONs and
  screenshots, the per-phase gate logs, the phase 0 validation log and the audio-latency probe
  results have none, contrary to the plan's rule for results from phase 1 onward. Those tree states
  cannot be reconstructed now. The phase 4 and final phase 5 parity reruns, with manifests,
  reproduce the phase 2/3 hash lists exactly.
- Deployment: verified on 14 September 2026 ([phase 6](#deployment-phase-6)).

### Independent inspection (phase 5)

Codex `gpt-5.6-sol`, read-only, in a fresh session that did not build the work, inspected the full
`git diff 12b727e` against the plan. The first attempt and one resume of the same session
disconnected ("Unable to verify model access right now") before producing a report. With the user's
approval, a fresh read-only session ran the same prompt and completed.

Round 1 verdict **CHANGES REQUIRED**, six findings:

| #   | Severity | Finding                                                                                     | Disposition                                                                                                                                                                                                                                                                                                |
| --- | -------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Medium   | No browser validation on the final snapshot; the recorded run predates the hello loop edit. | Fixed: `validation.html` rerun on the final tree in headful Chrome over CDP: 153 PASS, 0 FAIL, 0 SKIP, `ALL CHECKS PASSED`, no console messages, with manifest.                                                                                                                                            |
| 2   | Medium   | Three game-side type assertions (`demo/game.ts` grid initializer and both `findPlayer`s).   | Fixed: an annotated arrow return and uninitialized `let found: PlayerRow \| undefined`; no assertion remains in the game diff. Emitted JavaScript differs only in `let found;` versus `let found = undefined;`. Typecheck and 141/141 tests pass, and the final parity rerun matches all three hash lists. |
| 3   | Medium   | Manifests missing for many raw results, including phase 2/3 parity files.                   | Recorded as a provenance gap in the verification record above; it cannot be regenerated for past tree states. The user waived the gap.                                                                                                                                                                     |
| 4   | Medium   | `plans/NGNE-27-review-log.md` is append-only but had been reformatted.                      | Fixed: restored byte-for-byte. The phase 5 `npx prettier --check plans/NGNE-27-*.md` gate therefore reports that file, which has been unformatted since its commit `4760fe7`. The user granted an exception for that file.                                                                                 |
| 5   | Low      | The WebGL scan matched "WebGL era" in platformer finding 15, added after the phase 4 scan.  | Fixed: reworded; both scans return nothing.                                                                                                                                                                                                                                                                |
| 6   | Low      | The roadmap still called post-migration measurements pending.                               | Fixed: measurements done, deployment verification pending.                                                                                                                                                                                                                                                 |

The benchmarks, sustained runs and Chaos-only A/B above ran before fixes 2 and 5. Those fixes change
only TypeScript annotations and Markdown, and the emitted JavaScript is behaviourally identical, so the
measurements still describe the final code.

Round 2, resuming the same read-only session, checked the four fixes, the recorded user decisions and
the byte-identical review log. Verdict **APPROVED**, with no findings.

### Deployment (phase 6)

Recorded 14 September 2026.

- Pre-commit gate on the phase 5 tree: `npm run format` changed nothing (identical `git diff HEAD`
  SHA256 before and after); `npm test` 141/141; typecheck, build, `format:check` and `git diff --check`
  pass; the plan's WebGL scan returns nothing.
- C1 `7ac4f93450362830f8e8c1afd17bae53dadc168a` (`[NGNE-27] Remove WebGL and bridge, record final
measurements and inspection`) contains all phase 4–5 changes. Phases 0–3 are in `54bc67a`, which was
  not yet on `origin/main`; the user-authorized push `4760fe7..7ac4f93` published both.
- CI: "Verify and deploy" run
  [34883013454](https://github.com/that-webdev-dude/ngne/actions/runs/34883013454) for C1 completed
  with `verify` and `deploy` both successful.
- `MANUAL (user)` live check against C1, Chrome hard reload: `https://that-webdev-dude.github.io/ngne/`
  (Starfall), `/examples/hello/` and `/examples/platformer/` all start and render, with no WebGL 2 text
  and no console errors. Confirmed by the user.
- The docs-only closeout commit C2 records this section; its CI run and the post-C2 Starfall reload
  are reported in the phase 6 completion report because a commit cannot record its own run.

## NGNE-21 — 12 September 2026

Local, uncommitted WebGPU implementation against pre-build HEAD
`94a70a0393060707908a226c9e2d2107bdbae01c`. The initial working tree contained only
the three NGNE-21 planning records. The approved plan remains byte-identical at
SHA256 `1434e02d24371c1501357a59b7b667b494f8d6afb8fa4d2987ac8afd271f2c5f`.
Only the pinned cluster-renderer `.versions/v03` source at
`34458a987f03b00894e98a40d39fc0ae666194f6` was adapted; that repository remains clean
and unchanged. [Decisions](decisions.md#webgpu-renderer-adaptation) identifies the adaptations.
No commit, push, publication or Jira update belongs to this run.

### Proof and environment

Phase-by-phase evidence and the complete independent inspection results belong to
[the review log](../plans/NGNE-21-review-log.md). Codex built phases 1–4 and most of
phase 5, then stopped at its usage limit before final inspection. Claude Code (Opus 5)
continued as builder. It fixed the Frame inlining regression below and the inspection
findings. Inspection used a fresh read-only Claude Opus subagent instead of the claudex
runner, which requires Codex as host. Round results are in the review log.

Post-fix proofs on 12 September 2026: `npm.cmd test` 134/134, typecheck, build,
`format:check` and `git diff --check` passed. `validation.html` in the in-app Chromium
152.0.7977.76 (same Intel `gen-12lp` adapter, secure localhost) finished 182 PASS,
0 FAIL, 0 SKIP and `ALL CHECKS PASSED` with no console errors. This includes persistent
hello unsupported/recovery messages rechecked after 500 ms. Hello rendered through
WebGPU; the platformer and Starfall started on WebGL.

Raw machine-local diagnostics are outside the checkout:
`C:/Users/jfabi/AppData/Local/Temp/ngne-21-build-diagnostics-20260912/`.
They are evidence for this local run, not portable checked-in test results.

Hardware validation uses secure localhost, Windows 11 Home x64 (10.0.26200), Chromium 152, DPR 1 and
preferred `bgra8unorm`. The actual WebGPU adapter reports vendor `intel`, architecture
`gen-12lp`, `isFallbackAdapter: false`; device/description are empty. Backend and driver
are not exposed by this API and are not inferred from WebGL. Acquired device limits
are maxBufferSize 268435456 and maxTextureDimension2D 8192; no optional features or
raised limits are requested. Headful benchmark Chrome reports **152.0.7977.84**,
V8 **15.2.124.21**, window 1280×900 (inner viewport 1264×805), fixed 640×360 canvas.
CPU: 12th Gen Intel Core i7-12650H, 16 logical cores, 16 GiB; Node v24.15.0.

Real GPU checks exercise the production encoder, preferred-format targets, 256-byte
aligned readback and explicit BGRA-to-RGBA conversion. Nonsymmetric pixels are exactly
RGBA **224,64,32,255** and **32,64,224,255**. Alpha/decoded image comparisons allow two
8-bit channel values of rounding; reconstructed Float32 centers allow 1e-4 pixels.
Coverage includes centered/signed/rotated geometry, UV quadrants, transparent ordering,
empty clear, A/B/A adjacent runs, 10,000 sprites, active uploads and buffer reuse, plus
65 interpolation samples through each renderer.

Image/lifecycle checks cover shared cold preparation without activation, same-candidate
retry after input rollback, fresh preparation after setup rollback with another live
candidate, stop/resume, fixed backing restoration, GPU-before-Assets disposal, exact
visible hello capability/recovery messages, and balanced scopes after a synchronously
throwing copy on a real device. Controlled `GPUDevice.destroy()` restores both leased
and snapshotted source pixels exactly to **192,64,128,255** on a fresh device. This is
real hardware rendering with controlled loss, not physical driver fault evidence.
Mocks separately cover denied/lost/reupload-failed replacements, membership churn,
stale callbacks, disposal during asynchronous stages, missing textures and frame faults.

### Measurement method

The fixed fixture reuses one authoring sprite for 10,000 quads, with one-texture and
alternating-two-texture arms. Each backend/arm receives two sequential launches in the
same visible Chrome/window, 10 s warmup and 60 s sampling. Preparation and submission
timings measure CPU work only; neither waits for per-frame GPU completion. The one
texture arm submits one draw; alternating textures submit 10,000 draws to preserve
order. WebGPU uploads 560,000 active instance bytes plus 48 uniform bytes; legacy
uploads 560,000 instance bytes. Both retain three bindings (white plus two images).
WebGPU grows its instance capacity once to 10,000; legacy grows once to 16,384.

The harness forces GC after warmup and sampling, records visibility changes, frame
distributions, heap samples and a DevTools allocation profile. Sampling interval is
32,768 bytes with collected objects included for both minor and major GC. Source-site
summaries and complete allocation call trees are retained with each result. Sampling
is statistical; source inspection also checks numeric packing/repacking loops for
object wrappers and typed-array subviews. Per-frame GPU encoder/view descriptors and
sorting/runtime allocations are permitted. Heap growth also includes the harness's
frame and heap records, so it does not isolate renderer retention.

An initial smoke profile found repeated Frame metadata-array growth. The implementation
now retains arrays while packing and trims the active prefix at sort. A subsequent
10 s warmup/3 s diagnostic probe found no sampled Frame packing or WebGPU repacking
allocation sites. The first sustained sample was rejected because its window became
hidden; its raw file is preserved with `.hidden-rejected`. Accepted samples must remain
visible throughout. The probe durations are not substituted for the required sustained runs.

Reproduce against `npm.cmd run dev -- --port 5173`:

```powershell
$env:NGNE_URL='http://127.0.0.1:5173/validation.html?rendererBenchmark=webgpu&alternating=0'
$env:NGNE_WARMUP_SECONDS='10'
$env:NGNE_DURATION_SECONDS='60'
node --import tsx tests/browser-baseline.ts
# Repeat twice for webgpu/webgl and alternating=0/1; keep Chrome visible.
```

The existing Chaos CPU harness compares the actual pre-build and changed Frame
preparation with identical seed `bench`, 900 ticks and 799 post-warmup samples.
This separates NGNE-21 from earlier NGNE-20 ECS effects. NGNE-26's historical
~6.7–7.2 MiB/s Starfall churn is context only; it is not workload-equivalent to the
fixed renderer fixture. Unchanged Starfall WebGL remains a regression check;
NGNE-27/NGNE-12 own the complete real-game WebGPU migration/comparison.

### Sustained renderer results

All eight accepted samples lasted 60.00–60.02 seconds with no visibility changes,
no fixture diagnostics and no page errors. Names below are backend–alternating–repeat:
`0` is one texture, `1` alternates two textures. Each percentile cell is p50 / p95 / p99
in milliseconds; retained heap is MiB after forced GC, warmup → end.
Raw files are `renderer-{name}.json` in the diagnostics directory; each includes the
absolute path to its full allocation profile under `ngne-baseline-*/allocation-profile.json`.

| Run        | Frames | CPU preparation    | CPU submission        | CPU total             | Retained heap |
| ---------- | -----: | ------------------ | --------------------- | --------------------- | ------------- |
| webgl-0-1  |   3601 | 2.30 / 3.20 / 3.80 | 3.10 / 4.60 / 5.20    | 5.40 / 7.30 / 8.10    | 6.657 → 6.164 |
| webgl-0-2  |   3601 | 2.50 / 3.30 / 3.80 | 2.60 / 4.40 / 5.10    | 5.10 / 7.30 / 8.00    | 6.657 → 6.164 |
| webgl-1-1  |   2626 | 0.40 / 0.50 / 0.70 | 22.00 / 24.90 / 26.40 | 22.40 / 25.20 / 26.80 | 6.695 → 6.781 |
| webgl-1-2  |   2628 | 0.40 / 0.50 / 0.80 | 22.10 / 24.70 / 26.10 | 22.50 / 25.10 / 26.50 | 6.650 → 6.736 |
| webgpu-0-1 |   3601 | 2.30 / 3.30 / 3.90 | 3.10 / 4.40 / 4.90    | 5.40 / 7.10 / 8.00    | 5.727 → 5.960 |
| webgpu-0-2 |   3600 | 2.20 / 3.20 / 3.80 | 2.90 / 4.20 / 4.80    | 5.10 / 6.80 / 7.60    | 5.677 → 5.911 |
| webgpu-1-1 |   3601 | 0.60 / 2.00 / 2.70 | 3.50 / 6.00 / 7.80    | 4.30 / 7.40 / 9.20    | 5.726 → 5.960 |
| webgpu-1-2 |   3601 | 1.10 / 2.80 / 3.30 | 4.70 / 7.70 / 9.40    | 6.10 / 9.30 / 10.90   | 5.723 → 5.998 |

One-texture medians were effectively equal between backends in each repeat. Alternating
texture submission was lower with WebGPU, but WebGPU's second alternating run was
noticeably slower than its first. These differences include JIT/profiler/system noise;
they are not GPU execution measurements. No warmed sample reported an allocation site
in Frame.add/sprite or WebGPU prepare/repacking. Recorded WebGPU sites were encode and
sort; legacy sites were render. The retained-heap movement includes harness data and
GC variation; buffer growth stayed at one and bindings at three in every arm.

### CPU regression comparison

The same unchanged `npm.cmd run bench` harness ran before implementation and after the
final production build. Both runs report HEAD `94a70a0`: the latter includes this
uncommitted diff. Raw files are `baseline-bench.txt`, `final-bench.txt` and
`final-bench-inlining-fix.txt`.

| Chaos simulation + Frame preparation | p50 ms | p95 ms | p99 ms | Mean ms |
| ------------------------------------ | -----: | -----: | -----: | ------: |
| Pre-build                            | 0.7519 | 1.0679 | 1.3579 |  0.7963 |
| First affine Frame                   | 0.9209 | 1.1585 | 1.4613 |  0.9414 |
| Final (`packAffine` extracted)       | 0.7685 | 1.0515 | 1.2900 |  0.8029 |

The first affine `Frame.add` median was **22.5% higher**. Cause: its bytecode grew from
423 to 514 bytes, above V8's default 460-byte inlining limit (Node 24
`--print-bytecode`). The same code with `--max-inlined-bytecode-size=2000` measured
0.746–0.749 ms, and the old 13-field code with a 14-float stride measured 0.746–0.756 ms.
So the packing arithmetic and stride are not the cost; lost inlining is. Moving the affine
write into module-scope `packAffine` and buffer growth into `grow()` reduces `add` to
363 bytes. It writes identical values. Same-session triples: pre-build Frame
0.747–0.766 ms, first affine 0.834–0.879 ms, final 0.737–0.749 ms. The recorded final
run above is 2.2% above the pre-build median, within run-to-run noise. All runs reached
7,209 sprites and 6,986 entity slots with zero sampled ticks over 16.67 ms. Final typed
ECS median was 0.1953 ms (pre-build 0.1959 ms); collision-grid schema/legacy ratio 1.063
(pre-build 1.168). The browser renderer and Starfall samples in this section predate
the inlining fix; that fix changes CPU cost, not output. No universal performance
threshold was added to the approved plan.

Production Starfall Chaos Lab (`starfall-regression.json`, seed `STARFALL-1989`)
ran 10 s warmup plus 60.018 s visible sampling: 3,601 callbacks, CPU callback
p50/p95/p99 **5.60/8.60/10.20 ms**, no intervals above 25 ms and no dropped ticks
during sampling (15 accumulated during startup/warmup). No page error or visibility
change occurred. Heap after forced GC moved 4.829 → 6.651 MiB, including harness
records; coarse sampled reclamation was 2.874 MiB/s. This checks the retained WebGL
game path and is not a same-session pre-change browser comparison.

### Limits

Only one Intel adapter and Windows Chromium were exercised. No physical driver reset,
additional vendor/OS/browser, physical touch/gamepad, or WebGPU CI acceptance is claimed.
Controlled/mock failures are identified above. Local timings have sampling, profiling,
browser and system-load noise and imply no universal speedup or frame-rate guarantee.
WebGL and object ECS bridges remain until NGNE-27; NGNE-13 CI and NGNE-14 portability
are separate work. The public declaration fixture disables ambient GPU types and checks
library declarations; headless Game does not initialize browser/GPU services.

Primary API references refreshed during implementation: [WGSL layout](https://www.w3.org/TR/WGSL/#alignment-and-size),
[writeBuffer element units](https://gpuweb.github.io/types/interfaces/GPUQueue.html#writeBuffer),
[image-copy alpha and usage](https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/copyExternalImageToTexture),
[device loss](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost),
[canvas configuration](https://developer.mozilla.org/en-US/docs/Web/API/GPUCanvasContext/configure),
[bitmap options](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap),
and [allocation sampling](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/#method-startSampling).

## NGNE-20 — 10–11 September 2026

Local uncommitted implementation at baseline revision **`a906f3a`** on Windows 11 x64,
Node v24.15.0, 12th Gen Intel Core i7-12650H (16 logical cores), 16 GiB. The change
adds schema-defined typed-array SoA storage and keeps Starfall/platformer on the legacy
object bridge for NGNE-27.

### Automated checks

- `npm.cmd test`: **108 passed, 0 failed**, including focused schema
  field/chunk/lifetime/order/borrow/inspection/resource assertions, opaque query/facade
  boundaries, legacy-query compatibility, and a headless mount/render regression for the
  actual hello scene, plus all unchanged game suites.
- `npm.cmd run typecheck`: passed. `tests/api-misuse.ts` covers inferred schema columns,
  sparse field values, the zero-query distinction, immutable definitions, mixed-mode
  rejection, schema `get()` rejection, private RNG state, and absent runtime constructors.
- `npm.cmd run build`: passed; emitted declarations/API misuse compilation and production
  Starfall, hello, and platformer bundles succeeded.
- `npm.cmd run format:check` and `git diff --check`: passed.

### CPU benchmark

Two consecutive otherwise-idle `npm.cmd run bench` executions used 100 warmups and 300
samples for the 20,000-entity typed ECS pass. The unchanged Chaos control used seed
`bench`, 900 ticks, and 799 samples after tick 100. Times are milliseconds.

| Workload             | Run |    min |    p50 |    p90 |    p95 |    p99 |    max |   mean |
| -------------------- | --: | -----: | -----: | -----: | -----: | -----: | -----: | -----: |
| Typed ECS            |   1 | 0.1786 | 0.1888 | 0.2204 | 0.2314 | 0.3305 | 0.6947 | 0.1984 |
| Typed ECS            |   2 | 0.1760 | 0.1893 | 0.2126 | 0.2481 | 0.3209 | 0.5380 | 0.1970 |
| Legacy Chaos control |   1 | 0.6483 | 0.7496 | 0.9202 | 1.0118 | 1.2166 | 1.4005 | 0.7840 |
| Legacy Chaos control |   2 | 0.6760 | 0.7684 | 0.9049 | 1.0207 | 1.2517 | 1.6631 | 0.7990 |

Both runs reached 7,209 sprites and 6,986 entity slots with zero sampled Chaos ticks
over 16.67 ms. The NGNE-26 object ECS medians were 0.420/0.421 ms under the same
20,000-entity workload; the typed medians here are 53–55% lower on this machine. Chaos
is an unchanged legacy-game control, not an SoA result, and its medians were higher than
NGNE-26's 0.697/0.694 ms. These local CPU measurements are not universal throughput or
whole-game improvement claims.

The NGNE-26-comparable ECS section commits once before warmup and does not include the
per-commit-epoch descriptor reconstruction a game pays on its first typed query after a
tick commit. The collision-grid section below includes index rebuild and query traversal
cost, but also remains within one commit epoch per arm.

The final harness section compared fixed equivalent synthetic collision-grid arms: 260
cells, 256 targets, 512 probes, 64 build/probe batches per sample, 100 warmups, 300
samples, and 32,512 candidate checks per sample. Each timed batch clears and rebuilds
through the supported legacy `each()` or schema `eachChunk()` query path before probing.
Measured timer resolution was 0.0001 ms; both arms' medians exceeded the required 0.01
ms validity floor. Values below are nanoseconds per candidate check.

| Arm             | Run |    min |    p50 |    p90 |    p95 |    p99 |    max |   mean |
| --------------- | --: | -----: | -----: | -----: | -----: | -----: | -----: | -----: |
| Legacy object   |   1 | 27.996 | 30.349 | 36.122 | 39.847 | 52.574 | 62.445 | 31.628 |
| Schema view/row |   1 | 30.595 | 33.800 | 40.034 | 42.298 | 49.222 | 56.124 | 34.804 |
| Legacy object   |   2 | 29.448 | 30.807 | 36.851 | 39.272 | 44.018 | 59.907 | 32.233 |
| Schema view/row |   2 | 30.899 | 34.200 | 41.837 | 44.122 | 58.800 | 64.195 | 35.723 |

Schema/legacy median ratios were 1.114 and 1.110. Neither run exceeded the 1.20
threshold, so the plan's material-regression stop condition was not met. This synthetic
result proves the view/row shape is expressible; it does not establish cost neutrality
for Starfall. NGNE-27 must measure the migrated real collision loop against the NGNE-26
baseline.

### Browser evidence and limits

The production build was served with `npm.cmd run preview`, and the real
`http://127.0.0.1:4173/examples/hello/` page was observed in the visible Codex In-app
Browser. Its embedded Chromium version and GPU/renderer strings were not exposed by the
available inspection surface. The default viewport was 364 × 694 CSS pixels at DPR 1.25;
the 640 × 240 canvas rendered at 300 × 113 CSS pixels.

Over 9 seconds, ten one-second visible samples showed the cyan sprite advance across the
dark canvas, reach the 640 edge, wrap to 0, and continue from the left. Six additional
samples over 500 ms showed small, even intermediate advances, consistent with smooth
interpolation rather than simulation-step jumps. The canvas remained visible and the
page ended with zero captured console errors or warnings; no page error or unhandled
exception was reported. This closes the required production hello proof.

The headless regression remains complementary coverage for exact midpoint interpolation
from 40 to 80 and the 640-to-0 pose reset. The two 60-second visible Starfall/platformer
control runs were not repeated: those consumers remain unchanged on the legacy ECS, so
their existing NGNE-26 results remain the comparison baseline until NGNE-12/27 measures
the migrated games. No whole-game SoA or cross-browser/device performance claim is made.

### Independent inspection

Claude Code 2.1.267 inspected two fresh snapshots with its CLI default model (requested
model unresolved). Round 1 returned `REVISE`; fixes moved schema validation ahead of
slot allocation, restored cached legacy query columns, rejected duplicate queries at
entry, added the headless hello regression, and pinned deliberate per-epoch descriptor
allocation and disposed-world behavior. Round 2 also returned `REVISE`; its high-severity
finding identified an enumerable TypeScript-private `WorldAccessRuntime.world` escape to
the full runtime. The final local fixes use a true `#world` field, time both grid rebuild
paths through their supported query APIs, add the missing boundary/order/inspection
coverage, reject float32 overflow and malformed references, and align the public-symbol
inventory and benchmark limits.

An explicitly authorized third fresh inspection returned `REVISE`. Its three medium
findings identified query-runtime access to the full `World`, unequal collision-grid
benchmark work, and the missing visible-browser proof. Six low findings covered an
entity-reference edge, facade binding, legacy-query compatibility, entity-reference
defaults, explicit `undefined`, and weak test assertions. The code and tests now use true
private query state, bound opaque facade methods, equivalent benchmark reads, null-only
reference defaults, complete reference validation, preserved legacy-query behavior, and
the requested focused assertions. Visible-browser proof remains open; the final fresh
inspection carries that as an explicit delivery limit.

The previous final fresh inspection returned `REVISE` with no storage, identity, ordering,
or ownership defect. Its medium finding was the then-missing visible-browser hello proof;
the evidence above closes it. Two low findings identified forged descriptor defaults and
removal of the shipped legacy ECS from the roadmap. Descriptor construction now normalizes
forged numeric defaults and rejects every non-null entity-reference default, with
regression coverage; the roadmap retains the implemented legacy bridge and restores the
NGNE-20 outcome. The complete post-closure snapshot, including both low fixes and this
browser evidence, is the scope of the final explicitly authorized fresh inspection.

## NGNE-10 — 10 September 2026

Audio lifecycle was exercised through the shared service and both games on Windows
11 x64 10.0.26200.9445, Node v24.15.0, Vite 7.3.6 and the Chromium 152 Codex
in-app browser, DPR 1.

### Repeatable case list

1. Run `npm test`. Require the audio service cases to prove commit-time queue flush,
   stale queued-request removal, independent equal-named scopes, the 128-request and
   32-voice limits, mute/ducking, suspend/resume, unlock rejection, best-effort scope
   cleanup with all failures aggregated, and terminal disposal after a close failure.
2. In the same suite, require Starfall to reuse one decoded buffer through three scene
   replacements, release every replaced scope and dispose the cached asset once. Require
   the platformer death/remount case to start one looping clip per scene, release the old
   scope and dispose the cached asset once at Game disposal.
3. Run `npm run dev`, open `/validation.html`, choose **Run checks**, and require the five
   audio lines plus `ALL CHECKS PASSED`. They use a real `AudioContext` to unlock from the
   click, decode and share a WAV buffer, start a loop and oscillator in independent
   equal-named scopes, change scope/master gain, suspend/resume, release scopes and reject
   unlock after terminal disposal.
4. Open Starfall, choose **Sound off** so it reads **Sound on**, then **Start Flight**.
   Pause and resume once, choose **Chaos Lab** three times and require `CHAOS LAB /
INVULNERABLE`, no error UI and no console warning/error.
5. Open `/examples/platformer/`, choose **Start level 1**, then pause/resume three times.
   Require `Level 1 · Attempt 1 · Start · Deaths 0 · Runs 0`, `Reach the blue gate`, no
   error UI and no console warning/error.
6. Run `npm run typecheck`, `npm run format:check`, `npm run build` and
   `git diff --check`.

### Results

- `npm test`: all **95** tests passed. The new deterministic cases cover both game
  consumers, decoded-buffer lease reuse, repeated replacement/remount, stale requests,
  limits, unlock/close rejection and four independent failures during one scope cleanup.
- `npm run typecheck`, `npm run format:check`, `npm run build` and `git diff --check`:
  passed. The production build includes both games and the browser audio checks.
- `/validation.html`: all **112** checks passed, including the five real-browser audio
  checks, with no console warnings or errors.
- Starfall passed sound enable, start, pause/resume and three consecutive Chaos Lab
  replacements. The platformer passed start and three pause/resume cycles. Both decoded
  their scene music during preparation, stayed in active gameplay and showed no error UI
  or console warning/error.

### Limits

The browser checks prove decoding, Web Audio graph operations, lifecycle promises and
failure-free game integration in Chromium. This agent cannot hear the host's physical
speaker output, so subjective audibility, balance and sound quality are not claimed.
Firefox, Safari, mobile hardware and background-tab audio policy were not tested. No
performance claim is made.

## NGNE-9 — 10 September 2026

Input focus and cancellation were validated and hardened in the shared `Input` service
used by Starfall and the platformer. Local Windows 11 x64 10.0.26200, Node v24.15.0,
Vite 7.3.6 and the Chromium 152 Codex in-app browser, DPR 1.25.

### Repeatable case list

Run `npm run dev`, open `/validation.html`, and require `ALL CHECKS PASSED`. The input
portion runs these cases in order:

1. Focus the canvas; deliver an arrow key; require one press plus held state and default
   scrolling prevention.
2. Focus a button; deliver Space; require native button behavior, no game press and a
   release for the key held before focus left the canvas. Deliver a key directly to
   `window`; require it to be ignored without an exception.
3. Deliver a pointer at 75%/25% of a 200 × 100 CSS canvas mapped to 100 × 50 logical
   pixels; require `(75, 12.5)`. Resize CSS to 400 × 200, deliver at 25%/75%, and require
   `(25, 37.5)`.
4. Hold `Pointer0`, lose pointer capture, and require its release plus inactive pointer
   state. Repeat with `Pointer2` and `pointercancel`.
5. Simulate pad 0 with button 0 and axis 0 held; require `Pad0` and axis `0.5`. Disconnect
   it; require a release. Reconnect pad 1 with button 9 held; require a fresh `Pad9` press.
6. Blur while pad 1 remains held; consume the release while unfocused, refocus and require
   no reacquisition. Return it to neutral, press again, and require a fresh edge.
7. Queue a key before a zero-tick frame; require no consumption. Advance a two-tick
   catch-up frame; require the edge only on tick one and held state on both ticks.
8. Stop while that key is held, release it while stopped, resume, and require the first
   tick to contain its release with no held action.

For each visible game, start through its button, confirm the canvas has focus, press P,
require its paused UI, then resume through the page button and require active gameplay.
Starfall must show `FLIGHT PAUSED` then `FLIGHT IN PROGRESS`; the platformer must show
`Paused` then `Reach the blue gate`. Neither page may show its error UI or emit a console
error.

### Results

- `npm test`: all **91** tests passed, including input edge retention and explicit clear
  release coverage plus the existing complete Starfall and platformer suites.
- `npm run typecheck`, `npm run build` and `npm run format:check`: passed. The build
  includes emitted declarations, the public API misuse fixture and all browser entries.
- The new browser input module also passed a separate strict TypeScript check with
  ES2024 DOM libraries.
- `/validation.html`: all **107** checks passed with no console errors. Fifteen input
  checks cover the case list above; existing renderer, lifecycle and 65 interpolation
  checks also passed.
- Starfall and the platformer passed the focused P-key pause and button-resume flows
  above. No console errors were recorded on either page.

### Device limits

| Input source        | Device / method                                                        | Result                                                                  |
| ------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Keyboard            | Browser-generated key delivery on Windows, Chromium 152 in-app browser | Passed canvas focus, cancellation and both-game pause/resume flows      |
| Pointer / mouse     | Browser clicks plus deterministic `PointerEvent` cancellation cases    | Passed button preservation, resize mapping, cancel and capture loss     |
| Physical keyboard   | No manually operated device                                            | Untested                                                                |
| Physical touch      | No touch-screen device available                                       | Untested; synthetic pointer coverage is not a physical-touch claim      |
| Physical controller | No controller available                                                | Untested; simulated Gamepad API hot-plug coverage is not a device claim |

No Firefox, Safari, mobile hardware, multi-controller ownership or local multiplayer
claim is made. This ticket changes input ownership/cancellation only; it makes no
performance claim.

## NGNE-7 — 10 September 2026

Owner-scoped scene candidate slots replaced duplicated readiness, retry, refill and
release bookkeeping in Starfall and the platformer. Local Windows 11 x64 10.0.26200,
Node v24.15.0, Vite 7.3.6 and the Chromium 152 Codex in-app browser.

### Automated checks

- `npm test`: all **91** tests passed. New lifecycle checks cover same-purpose
  deduplication, refill after single-use take, explicit release, one bounded retry,
  final diagnostic reporting, stale-owner cancellation and prevention of late take.
  Existing platformer coverage repeats pause cycles across readiness gaps, delayed
  respawn, level replacement, completion/restart, failed preparation, failed mount,
  stop/resume, disposal and late delivery. Its deterministic 1,448-tick two-level
  walkthrough still completed twice with identical enumeration.
- `npm run typecheck`, `npm run format:check`, `git diff --check`: passed.
- `npm run build`: passed, including emitted library declarations, the public API
  misuse fixture and all three browser entries. Vite required approved execution
  outside the normal filesystem sandbox for its config lookup.

### Browser checks

- `/validation.html`: all **92** checks passed with no console errors. This includes
  renderer/context restoration, browser-host lifecycle races and 65 sampled
  interpolation/discontinuity frames.
- Starfall: Start Flight succeeded, then three Pause/Resume button cycles returned
  `FLIGHT PAUSED` / `FLIGHT IN PROGRESS` with the correct button label every time.
- Platformer: Start level 1 succeeded at `Level 1 · Attempt 1 · Start · Deaths 0 ·
Runs 0`, then three Pause/Resume button cycles returned `Paused` / `Reach the blue
gate` with the correct button label every time.
- Neither game displayed its error UI or emitted a browser console error.

### Limits

The browser session exercised repeated pause transitions in both games. Full level
replacement, completion/restart, controlled preparation failure, stale completion,
stop/resume and disposal use deterministic headless coverage rather than injected
faults in the visible games. Physical gamepad, touch, audible output, Firefox, Safari
and mobile hardware were not tested. No performance claim is made by this ticket.

## NGNE-15 — 9 September 2026

Two-level platformer example (`examples/platformer/`) built on the current engine
from the Codex-reviewed plan in `plans/NGNE-15-platformer.md`; the argument and
build log are in `plans/NGNE-15-platformer-review-log.md`. Windows 11 x64 10.0.26200,
Node v24.15.0. Commits `c6e693f` (plan), `5144c58`, `329a6c5`, `01d1dad` and this
record. No `src/` change: no engine defect was reproduced. Authoring friction is
recorded in [examples/platformer/FINDINGS.md](../examples/platformer/FINDINGS.md).

### Automated checks

- `npm run format:check`, `npm run typecheck`, `npm run build`, `git diff --check`:
  passed. The build emits `dist/examples/platformer/index.html` alongside Starfall and
  hello.
- `npm test`: 89 tests passed (66 before this ticket, 23 added in
  `tests/platformer.test.ts`). Coverage: tile collision (no tunnelling at the fall-speed
  clamp, one-way platforms, side walls, open top, spikes, fall-out line), controller
  (coyote 6 ticks, jump buffer 6 ticks, held-input jump cut), patrol turning and
  lethality, transition authority precedence (fatal > exit > checkpoint > pause),
  death remount from committed checkpoint, exit/complete/restart with each durable
  command dispatched once, latched pause through candidate replenishment, candidate
  registry release on replacement, completion, restart, stop, disposal and late
  same-key delivery, failed-preparation retry, failed-mount terminal phase,
  host-driven determinism at every tick, first-frame camera placement, alpha-1
  rendering through pause and the pop frame, scoped audio cues, and a deterministic
  reference walkthrough that completes both authored levels in 1,448 ticks with zero
  deaths and identical repeated enumeration.
- Existing suites (`interpolation`, `simulation.contract`, `lifecycle`, `state`,
  `ownership`, `game`) unchanged and passing; Starfall code untouched.

### Browser session

`npm run dev` (Vite 7.3.6) at `http://127.0.0.1:5178/examples/platformer/` in
**Chrome 152.0.7977.83**, viewport 958 × 854, DPR 1, GPU `ANGLE (Intel, Intel(R) UHD
Graphics (0x000046A3) Direct3D11)`. Driven through the Claude in Chrome extension:
real clicks and single key presses through the extension, held keys through
`KeyboardEvent`s dispatched on the canvas from a page-world script (they bubble to the
engine's `window` listener exactly like physical keys). Observed through the HUD text,
which reads `game.state` every frame, and screenshots.

| Check                                                               | Result                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Page load, Start button (audio unlock gesture), first frame         | Passed; HUD `Level 1 · Attempt 1 · Start · Deaths 0 · Runs 0`                                                       |
| Movement, jump, camera follow                                       | Passed; player crosses the level, camera scrolls with dead-zone                                                     |
| Death by falling, remount at start                                  | Passed; `Attempt 2 · Deaths 1`, player at start, held key still applied                                             |
| Level 1 completed (timed script: two gap jumps)                     | Passed; checkpoint 1 then exit, level 2 mounted with progress carried                                               |
| Level 2 completed (timed script: patrol, spikes, gap, one-way rows) | Passed after four failed timelines (25 deaths total); checkpoints 1 and 2, exit, `Game complete` overlay            |
| Completion overlay, Pause disabled, Play again shown                | Passed                                                                                                              |
| Restart from completion                                             | Passed; `Level 1 · Attempt 1 · Start · Deaths 0 · Runs 1`                                                           |
| Pause by P key, by Escape key, by DOM button                        | Passed; dimmed frame at alpha 1, HUD `Paused`, button reads `Resume`                                                |
| Resume by DOM button                                                | Passed; simulation continues, no visible pose jump                                                                  |
| Frozen frame during pause shows last committed poses                | Passed (screenshot mid-jump while paused)                                                                           |
| Tab-hide pause                                                      | **Not verified**: switching tabs through the extension did not leave the page hidden long enough to observe a pause |
| Console errors from the example or engine                           | None; the only exceptions came from the test driver before it targeted the canvas (see FINDINGS #9)                 |

Death timing measured from the HUD matched the fixed-step model to within one frame
(first patrol contact 2,350–2,370 ms after remount), which is how the timelines were
tuned; the 25 in-browser deaths are driver timing, not defects.

### Limits

- Physical gamepad (`axes[0]`, `Pad0`, `Pad9`), touch, additional browsers and audible
  output were not tested. The tab-hide pause path is covered only by the headless
  hidden-tab test.
- Human difficulty is not established; the reference walkthrough and the scripted
  browser runs show completability by the physics, not balance.
- Performance measurement was outside this ticket and is recorded under
  [NGNE-26](#ngne-26--9-september-2026).
- `/validation.html` was not re-run: no engine, renderer or browser-host code changed,
  and the NGNE-6 interpolation suite passes in `npm test`.

## NGNE-26 — 9 September 2026

Pre-migration performance baseline for NGNE-12 to compare against after the SoA
(NGNE-20) and WebGPU (NGNE-21) migrations. The harness and Starfall baseline use
revision **`6e14e2e`** (the NGNE-25 documentation commit; the last engine change was
NGNE-6). The platformer append uses **`058c559`**, the completed NGNE-15 revision; no
engine code changed between them. Windows 11 x64 10.0.26200, 12th Gen Intel Core
i7-12650H (16 logical cores), 16 GiB, Node v24.15.0.

### Harness (`npm run bench`)

Same workloads and seeds as every earlier entry: a 20,000-entity position/velocity
ECS pass with 100 warmup and 300 sampled iterations, then Chaos Lab (`arena({ stress:
true })`, seed `bench`) for 900 ticks of `tick` + `render` + `sort` at alpha 0.5,
sampling ticks 101–899 (799 samples). The harness now prints the full distribution
(min/p50/p90/p95/p99/max/mean), the sampled tick count that exceeded one 60 Hz step
(16.67 ms), the revision and the CPU. Two consecutive runs on an otherwise idle machine:

| Workload, ms                   | Run |   min |   p50 |   p90 |   p95 |   p99 |   max |  mean |
| ------------------------------ | --- | ----: | ----: | ----: | ----: | ----: | ----: | ----: |
| 20,000-entity ECS pass         | 1   | 0.228 | 0.420 | 0.862 | 0.960 | 2.375 | 4.504 | 0.538 |
| 20,000-entity ECS pass         | 2   | 0.229 | 0.421 | 0.476 | 0.525 | 0.644 | 2.907 | 0.383 |
| Chaos simulation + preparation | 1   | 0.557 | 0.697 | 0.927 | 1.172 | 1.466 | 1.695 | 0.737 |
| Chaos simulation + preparation | 2   | 0.550 | 0.694 | 0.950 | 1.125 | 1.443 | 1.958 | 0.742 |

Both runs peaked at **7,209 sprites and 6,986 entity slots** with **0 ticks over
budget**. The ECS tail differs between runs (p90 0.86 vs 0.48 ms) while medians agree
to 1 µs; treat p50 as the stable comparison point and the tail as run noise on this
machine. CPU only: no GPU submission, display or input polling. Dropped ticks are a
host-loop measure and are reported by the browser run below.

### Starfall sustained browser run (`npx tsx tests/browser-baseline.ts`)

Production build served by `npm run preview` at `http://127.0.0.1:4173/`, loaded in a
fresh-profile headful **Chrome 152.0.7977.83** launched with
`--remote-debugging-port`, `--enable-precise-memory-info` and a 1280 × 900 window
(1264 × 805 viewport, DPR 1). GPU: ANGLE Direct3D 11 on **Intel UHD Graphics
(0x46A3)**, the integrated GPU. The driver injects a `requestAnimationFrame` wrapper
before the page loads so every host frame callback (tick, frame preparation, WebGL
submission and the showcase's DOM telemetry update) is timed, samples
`performance.memory` every 250 ms, counts long tasks, clicks **Chaos Lab** through a
DevTools input event (a real gesture, required by the audio unlock), waits 10 s, forces
a garbage collection, then samples for 60 s and forces another collection.

Two consecutive runs, each a fresh browser launch:

| Metric                                    | Run 1                          | Run 2                          |
| ----------------------------------------- | ------------------------------ | ------------------------------ |
| Frames in the sampled 60.0 s              | 3,600                          | 3,601                          |
| Frame interval, ms (min/p50/p99/max)      | 15.3 / 16.7 / 17.2 / 17.9      | 15.9 / 16.7 / 17.0 / 17.5      |
| Frame intervals over 25 ms                | 0                              | 0                              |
| Host frame callback, ms (p50/p90/p95/p99) | 4.40 / 6.10 / 6.70 / 7.80      | 2.70 / 5.30 / 6.10 / 7.70      |
| Host frame callback, ms (min/max/mean)    | 1.0 / 10.5 / 4.31              | 1.0 / 12.9 / 3.03              |
| Dropped ticks during the sample           | **0** (counter 5 before/after) | **0** (counter 6 before/after) |
| Long tasks (> 50 ms) during the sample    | 2                              | 2                              |
| Sprites at start / end                    | 6,982 / 6,628                  | 6,978 / 6,630                  |
| Used JS heap, MiB (min/max)               | 4.50 / 17.42                   | 4.36 / 17.40                   |
| Garbage collections (heap drops) in 60 s  | 151, reclaiming 430 MiB        | 149, reclaiming 400 MiB        |
| Allocation churn, MiB/s (reclaimed/time)  | 7.2                            | 6.7                            |
| Retained heap after forced GC, MiB        | 4.80 → 6.48                    | 5.62 → 6.06                    |

The 5–6 cumulative dropped ticks occurred during the first seconds after launching
Chaos Lab (scene publication and first-frame growth), before sampling started. Frame
callback time includes the showcase's `updateUI` DOM writes, so it is an upper bound
on engine host work. Display pacing, dropped ticks and allocation churn repeat closely; the frame-callback
median differs by 1.7 ms between runs (4.40 vs 2.70 ms) on this laptop CPU, so p95/p99
(within 0.6 ms) are the steadier comparison points. The ≈ 7 MiB/s allocation churn is
the baseline characteristic
NGNE-12 compares against; the two known per-frame allocation sources are
`getUniformLocation` per frame and the two `subarray` views per sprite in
`Renderer.render` (`src/renderer.ts`), recorded here as characteristics, not fixes.
Retained heap after forced GC grew +1.7 MiB in run 1 and +0.4 MiB in run 2 over one
minute: consistent with capacity growth following peak demand plus sampling noise, not
evidence of a leak either way; NGNE-12 should repeat the forced-GC comparison over a
longer window.

Method notes: an earlier attempt inside the embedded Claude browser pane was
discarded because the hidden pane throttled `requestAnimationFrame` (9 frames in
14 s, 2,065 dropped ticks); the driver therefore uses a visible real browser window.
Full JSON outputs for both harness runs and both browser runs were kept outside the
repository; the tables above are copied from them without rounding beyond three
decimals.

### Platformer

Production build at revision **`058c559`** served by the same preview server and run in
the same Chrome, GPU, window, viewport and DPR as Starfall. The driver opened
`/examples/platformer/?baseline`, used a DevTools user gesture to start level 1, then
measured an idle player at the start while all level systems and patrols remained
active. The `baseline` query enables app-host telemetry for dropped ticks, sprites and
smoothed FPS; it does not change simulation or rendering. Warmup, sample duration,
frame timing, heap sampling and forced-GC method match the Starfall run.

Two consecutive runs, each a fresh browser launch:

| Metric                                    | Run 1                     | Run 2                     |
| ----------------------------------------- | ------------------------- | ------------------------- |
| Frames in the sampled 60.0 s              | 3,601                     | 3,601                     |
| Frame interval, ms (min/p50/p99/max)      | 15.7 / 16.7 / 16.9 / 17.7 | 15.5 / 16.7 / 17.0 / 17.8 |
| Frame intervals over 25 ms                | 0                         | 0                         |
| Host frame callback, ms (p50/p90/p95/p99) | 0.4 / 0.7 / 0.9 / 1.1     | 0.5 / 1.0 / 1.1 / 1.5     |
| Host frame callback, ms (min/max/mean)    | 0.1 / 1.7 / 0.454         | 0.1 / 2.4 / 0.568         |
| Dropped ticks during the sample           | **0** (counter 2)         | **0** (counter 2)         |
| Long tasks (> 50 ms) during the sample    | 1                         | 1                         |
| Sprites at start / end                    | 63 / 63                   | 63 / 63                   |
| Used JS heap, MiB (min/max)               | 1.92 / 3.29               | 1.88 / 3.67               |
| Garbage collections (heap drops) in 60 s  | 51, reclaiming 31.0 MiB   | 51, reclaiming 30.4 MiB   |
| Allocation churn, MiB/s (reclaimed/time)  | 0.516                     | 0.506                     |
| Retained heap after forced GC, MiB        | 1.77 → 1.97               | 1.77 → 1.97               |

Both runs remained on level 1 at the start with no deaths or page error. The two
cumulative dropped ticks occurred during launch before warmup and sampling. Retained
heap grew about 0.20 MiB in each run; this one-minute local measurement is baseline
evidence, not proof of leak absence. The idle level-one workload is intentionally
reproducible and substantially lighter than Chaos Lab; it is not a worst-case
platformer claim.

### Checks

`npm run typecheck`, `npm test`, `npm run build` and `npm run format:check` after each
harness change. `tests/browser-baseline.ts` is a Node script run through `tsx` like
the benchmark; it is not part of `npm test`. The platformer append also ran two full
driver samples after a one-second launch probe; the earlier failed launch attempts
produced no measurements and exposed a synthetic-click issue fixed in the driver.

## NGNE-25 — 8 September 2026

Windows x64, Node v24.15.0. Documentation-only change; no engine, demo or example
code changed.

- One owning document per topic: ownership rules and exact API semantics in the
  implementation contract, rationale in decisions, usage in the guide, evidence
  here, direction in the roadmap; README orients and links. AGENTS.md, RULES.md and
  the Jira skill now state that rule instead of requiring every affected document
  to be listed and updated per ticket.
- `docs/capabilities.md` deleted after relocating its content: the capability table
  and its unique rules (stable authored identities, `Game` isolation, no
  board/tilemap/collision schema, storage growth follows peak demand, the
  ownership-inventory pointer) moved into the architecture; every "not required
  yet" list and the deferred/out-of-scope statuses moved into the roadmap.
- README lost its restated state, interpolation, inspection and lifecycle
  paragraphs; the interpolation authoring steps now live only in the guide. The
  roadmap's per-ticket prose became one status table; SoA/WebGPU/worker direction
  is one line pointing at NGNE-23. The contract and guide link to the architecture
  for tick commit order instead of restating it. The architecture's stale
  "Deferred decisions" list (APIs it called deferred are pinned in the contract)
  now points at the contract and roadmap.
- Documentation line count across README, RULES, AGENTS, `docs/` and the Jira
  skill: **2,062 → 1,897** (−165 lines, −8%), measured before this entry was
  added; 1,928 including it.
- Relative Markdown links and heading anchors resolved with a scratch script:
  **61 links, 0 broken**. `git grep` finds no reference to `capabilities.md`.
- `npm run format:check`, `npm run build`, `git diff --check`: passed.

Dated entries below are unchanged. No new rules were added and no behaviour claim
changed.

## NGNE-19 — 8 September 2026

Windows x64, Node v24.15.0, Git with `core.autocrlf=true`:

- Added `.gitattributes` (`* text=auto eol=lf` plus binary entries for images,
  audio and fonts), `.editorconfig` (4-space, LF, final newline, 2-space YAML),
  Prettier **3.9.6** pinned as a dev dependency with `.prettierrc.json`
  (`endOfLine: lf`, `tabWidth: 4`, `printWidth: 100`, `proseWrap: preserve`)
  and `.prettierignore` (dist, node_modules, caches, package-lock, binary assets).
- `git add --renormalize .` changed no index content: every tracked text file was
  already LF in the index; only the Windows working copy carried CRLF/mixed endings.
- `format` and `format:check` scripts target explicit paths (`src`, `demo`,
  `examples`, `tests`, `docs`, `.agents`, `.github`, `.vscode` and root files)
  rather than `.`: Prettier aborts directory expansion on an unreadable local
  `.test-output` subfolder before `.prettierignore` applies.
- CI runs `npm run format:check` before tests. RULES.md and README point at the
  scripts instead of describing style.
- Mechanical format: Prettier rewrote **45 files**; the ten touched by the tooling
  commit were formatted there, the other **35** in a separate commit with no other
  change. `git diff -w --numstat` over that commit is 1,085 added / 750 removed
  lines, all line wrapping at width 100, tests moving from 2 to 4 spaces, and
  Prettier's default punctuation; no statement, expression or document content changed.
- `npm run format:check`: passed. A deliberately misformatted temporary file
  outside the repository failed the same check with exit code 1.
- `npm test`: all **54 tests passed**. `npm run typecheck` and `npm run build`
  passed. `git diff --check`: clean.
- Fresh `git clone` of this checkout: `git status` clean and `git ls-files --eol`
  reports LF for every text file; a following `npm run format` produced no diff.

No engine, demo or example behaviour changed, so browser validation and
benchmarks were not rerun. Architecture, capabilities, decisions and the
implementation contract need no edit. No linter was added.

## NGNE-18 — 8 September 2026

Windows x64, Node v24.15.0:

- Removed the frozen `prototypes/ngne/v00` snapshot (20 tracked files) with
  `git rm -r prototypes/`. History was not rewritten. Recovery revision:
  **`1c8a76b`**, the last commit containing `prototypes/`. Restore with
  `git checkout 1c8a76b -- prototypes/` or read one file with
  `git show 1c8a76b:prototypes/ngne/v00/AUDIT.md`.
- `git ls-files --others prototypes` was empty before removal; NGNE-24 was Done.
- Repaired the references in README, roadmap, this record and the Jira skill
  context so no guidance requires a working prototype copy. Historical entries
  below now say "v00 prototype" instead of the removed path; their evidence is
  unchanged. `package.json`, tsconfig files, Vite config and CI never referenced
  the prototype paths, so no config change was needed.
- `git grep -n prototypes/` returns only these recovery notes.
- `npm test`: all **54 tests passed**. `npm run typecheck` and `npm run build`
  passed. `git diff --check`: clean.

No engine, demo or example code changed, so browser validation and benchmarks
were not rerun. Architecture, capabilities, decisions and the implementation
contract need no edit: they never referenced the prototype folder.

## NGNE-6 — 8 September 2026

Windows x64, Node v24.15.0; Codex in-app Chromium 152, DPR 1.

- Reproduced stale interpolation on the blocking-scene publication frame with
  `tsx --test tests/interpolation.test.ts` before the fix. Scene preparation now
  uses alpha 1 during suspension and after host resume until the scene updates.
  Camera/component state remains untouched; freeze alone retains effect interpolation.
- `npm test`: **54 tests passed**, including three new interpolation tests and the
  existing 11,000-tick Chaos run. `npm run typecheck` and `npm run build` passed,
  including emitted public declarations and the API misuse fixture.
- Vite dev/build initially failed because sandboxed parent-directory lookup was
  denied. The same commands passed with approved execution outside that restriction.
- `/validation.html`: **92 checks passed**, comprising 27 existing renderer/lifecycle
  checks plus **65 numeric/GPU transition frames**. No skipped checks or console errors.
  `tests/interpolation-scenario.ts` is shared by headless and browser validation;
  `tests/browser-interpolation-checks.ts` checks sprite center-line pixel coverage
  against the numerically validated frame positions, including offscreen clipping.
- Thirteen stages cover mount, scrolling, teleport/cut, freeze activation, continuing
  frozen effects, final frozen tick, first ordinary tick, blocking publication,
  sustained suspension, uncovering, scene resume and host resume before/after a tick.
  Each samples alpha **0, .25, .5, .75, 1** at fixed **1/60 s** simulation steps.
- Visual fixture uses **128 × 96** logical/backing pixels, displayed at **384 × 288**
  CSS pixels. Inspected the scrolling midpoint, hitstop endpoints (green actor fixed,
  blue effect advances), and suspension endpoints (all poses fixed). Select a frame
  using **Inspected frame** to repeat those views. These are deterministic sampled
  frames, not a display-refresh-rate or continuous-motion measurement.
- Numeric snapping coverage includes both axes, camera interpolation plus shake,
  positive/negative half-pixels, snap on/off and screen-space sprites. Frozen authored
  sprites and camera comparisons establish no write-back. Separate actor-only teleport
  and camera-only cut tests verify independent reset responsibility. Inspection checks
  prove rendering and stop/resume preserve simulation state.

CPU comparison using `npm run bench`, 100 ECS warmups / 300 samples and 900 Chaos
ticks (first 101 excluded), same Windows/Node environment:

| Workload                       | Before median / p95 ms | After median / p95 ms |
| ------------------------------ | ---------------------: | --------------------: |
| 20,000-entity ECS              |          0.233 / 0.264 |         0.259 / 0.510 |
| Chaos simulation + preparation |          0.656 / 0.850 |         0.720 / 0.995 |

Both runs peaked at 7,209 sprites and 6,986 entity slots. These single local runs
include runtime noise (the later run had browser validation open), exclude GPU time,
and do not establish a speed improvement or a statistically isolated regression.
The added presentation state is one boolean per scene; no per-entity storage changed.

Updated README, guide, rendering contract, architecture, decisions and roadmap.
Capabilities need no edit: existing interpolation, freeze and ownership requirements
remain intact. Starfall already separates ordinary/effect resets; no demo edit or
new public helper was needed. The frozen v00 prototype remains untouched.
Additional browsers, DPRs and physical mobile/gamepad devices remain untested; no
cross-device, GPU timing, replay, editor or save/restore claim is made.

## NGNE-5 — 8 September 2026

Windows x64, Node v24.15.0:

- Audited every production engine module, Starfall gameplay/browser/art entry
  points and hello. The implementation contract now inventories simulation state,
  derived caches, fixed authoring, host intent and presentation/service state.
  No additional mutable closure-only gameplay value required relocation.
- Found that inspection omitted fixed tick duration and empty archetype creation
  order. Added `GameInspection.dt` and `world.archetypes` (ordered component names
  and entity indices). Existing inspection fields and simulation behavior remain.
- `npm test`: all **51 tests passed**. Two new `tests/ownership.test.ts` cases
  cover empty archetype retention, free-stack/generation reuse, later query order,
  frozen detached metadata, and equal-seed Starfall inspections after each of 90
  ticks with rendering and a stop/resume interleaved in only one run. Existing
  lifecycle, freeze/suspension, state, full Chaos run and determinism tests pass.
- `npm run typecheck` and `npm run build`: passed, including emitted declarations,
  public API misuse fixture and both production consumers.
- `git diff --check` and changed-document local link/anchor checks: passed.

NGNE-1 and NGNE-3 were verified Done in Jira and integrated in this checkout.
Updated README, implementation contract, capabilities clarification and roadmap
alongside this evidence. Architecture and decisions need no edit: explicit owners
and deferred capture remain unchanged. Guide and examples need no migration:
the API additions are diagnostic metadata only, with guidance in README/contract.
The historical v00 prototype remains untouched.

Limits: inspection is lossy and may observe partial state outside completed
commits; live internal enumeration, accessor effects, graph/handle identity loss,
authored compatibility and host activation requirements are explicitly recorded.
No browser-dependent behavior or simulation hot path changed, so browser/device
checks and benchmarks were not rerun. No save/restore, replay controller, registry,
performance improvement or additional device support is claimed.

## NGNE-4 — 8 September 2026

Windows x64, Node v24.15.0:

- `npm test`: all 49 headless tests passed, including nine new regressions in
  `tests/simulation.contract.test.ts`.
- A three-scene scenario asserts bottom-to-top registration order, immediate
  component/resource writes, buffered births/deaths, event publication before
  freeze resets, longest freeze requests, ordered state dispatch and FIFO
  push/pop/set application. Newly mounted scenes read the final state and do not
  join the current update plan. Replacement cleanup runs top-to-bottom.
- Suspension retains an entire lower-scene inspection unchanged, including its
  freeze countdown and inbox. After suspension and freeze end, two ordinary
  consumers receive the broadcast once each; subsequent updates do not repeat it.
- Six failure cases cover both push and set mounts at the first, middle and last
  positions in a three-command sequence. World/event/freeze/state commits and
  preceding successful pushes survive; later pop/set commands are discarded,
  discarded candidates are released, private cleanup unwinds in reverse order,
  and the tick completes with the Game Running.
- Three deterministic runs compare complete public enumeration after each of
  24 ticks, including allocator state, resources, cameras, named RNG streams,
  event buffers, freeze and committed state. They vary rendering frequency,
  zero-tick/fractional/multi-tick frames and controlled asset completion order
  while retaining identical tick input and authored activation ticks/keys.
  Public enumeration already omits world-owner symbols; the comparison removes
  no additional fields. Rendering is also checked for simulation-state mutation.
- `npm run typecheck` and `npm run build`: passed, including emitted declarations
  and the public API misuse fixture. Runtime tests execute through `tsx`, following
  the existing test configuration.
- `git diff --check` and current documentation link checks: passed.

No production defect was found, so no runtime or API change was needed. Roadmap
coverage and this verification record are updated. Architecture, capabilities,
decisions, implementation contract, guide and examples need no changes: these
tests exercise existing rules without clarifying or changing supported behavior.
The historical v00 prototype remains untouched.

Limits: deterministic headless evidence only. No browser-dependent code changed,
so browser/device validation was not rerun. No benchmark or performance claim is
made; presentation checks cover CPU frame preparation, not GPU submission.

## NGNE-3 — 8 September 2026

Windows x64, Node v24.15.0, Chromium-based Codex browser:

- `npm test`: all 40 headless tests passed, including nine new state regressions
  in `tests/state.test.ts`. Coverage includes shallow-frozen nested objects/arrays,
  detached initial and transition values, cycles/aliases, sparse arrays, null
  prototypes, primitives, unsupported built-ins, accessors, command ownership and
  order, shared tick snapshots across scenes, replacement setup, dispatch lifetime,
  async transition rejection, partial command failure and event payload ownership.
- `npm run typecheck` and `npm run build`: passed. The build also compiles
  `tests/api-misuse.ts` against emitted package declarations. New positive/negative
  cases cover scene/Game compatibility, inferred commands, nested writes, transition
  inputs, async transitions and portable scenes without state requirements.
- Separate browser-fixture typecheck passed with `npx tsc --noEmit --strict
--target ES2022 --module ESNext --moduleResolution Bundler
--lib ES2024,DOM,DOM.Iterable --skipLibCheck tests/browser-lifecycle-checks.ts`.
- `/validation.html`: all 27 checks passed; no console errors. The migrated
  browser lifecycle consumer retains committed state through stop/resume.
- `npm run bench`: 20,000-entity ECS median/p95 0.356/0.409 ms;
  Chaos simulation/preparation 0.642/0.836 ms, 7,209 peak sprites and 6,986 slots.
  CPU only; this is workload evidence, not a before/after engine speed claim.
- `git diff --check`: passed. Current documentation links checked; historical
  the v00 prototype is untouched.

A focused before/after data-boundary measurement compared `c5860b8`'s
`immutable(structuredClone(value))` with the new `immutable(value)` on the same
64 room records (numeric id, boolean opened, four numeric scores). Each version had
500 warmups and 12 alternating batches of 200 copies. Median/p95 per copy:
**0.052/0.055 ms before, 0.186/0.192 ms after**. Descriptor validation and copying
cost more than the old incomplete validation. After 10,000 additional discarded
copies and forced GC, heap deltas were -9,096 and +80 bytes respectively; these
noisy local samples show no retained growth for this workload, not a leak guarantee.
Reads do not copy; scene resources remain the home for high-frequency mutable data.

The development server and final production build hit the existing parent-directory
filesystem restriction; both approved retries passed. An exploratory standalone
strict check of runtime test files is outside the repository configuration and
failed on missing Node type declarations and existing inspection-misuse cases.
Those files run through `tsx`; source and public type-contract checks above pass.
No dependency or unrelated test-configuration change was introduced.

Updated README, guide, implementation contract, roadmap, showcase and browser/test
consumers together. Architecture, capabilities and decisions need no changes:
this enforces their existing Game-owned state, explicit injection and tick ordering.
The hello example uses no committed-state access and needs no migration.
NGNE-1 was verified Done and its API restrictions remain intact.

Limits: authored field schemas are checked by TypeScript, while runtime validation
checks the plain-data domain. Untyped consumers can still supply the wrong game
schema. No save/restore format, physical-device or additional-browser compatibility,
GPU timing or performance improvement is claimed.

## NGNE-2 — 8 September 2026

Windows x64, Node v24.15.0, Chromium-based Codex browser:

- `npm test`: all 31 headless tests passed. New controlled-promise cases cover
  cancellation before first start, shared preparation consumers, late loader
  success/failure after disposal, and aggregated cold rollback failures.
- `npm run typecheck` and `npm run build`: passed, including emitted declarations
  and the existing consumer API misuse fixture.
- The new browser regression module also passed a separate strict TypeScript check
  with `--target ES2022 --module ESNext --moduleResolution Bundler
--lib ES2024,DOM,DOM.Iterable --skipLibCheck --noEmit`.
- `/validation.html`: all 27 checks passed, with no console errors. The 14 added
  checks cover overlap rejection, preserved scene/resource/RNG/freeze/state data,
  stale callbacks after restart, cold and resume rollback, terminal disposal across
  both late resume outcomes and late stop failure, repeated disposal and independent
  cleanup aggregation. Lifecycle races use controlled promises and an injected
  scheduler; only the existing WebGL restoration check uses a timer.
- `git diff --check`: passed.

The local server and production build required approved execution outside the
filesystem restriction because the bundler could not read parent-directory paths.

Updated the contract, README, guide and roadmap alongside the implementation.
Architecture, capabilities and decisions need no changes: this enforces the existing
terminal-disposal, rollback and ownership rules. Assets and audio need no source
changes: shared-load cancellation and terminal audio ownership already satisfy this
ticket; coordination belongs to Game/BrowserGame. Historical verification and
the v00 prototype remain unchanged.

Browser coverage uses real local WebGL services and controlled audio method promises;
it does not claim physical audio-device timing, mobile/gamepad testing or additional
browser coverage. No performance improvement or new device compatibility is claimed.

## NGNE-1 — 8 September 2026

Windows x64, Node v24.15.0, Chromium-based Codex browser:

- `npm test`: all 27 headless tests passed, including detached/frozen inspection,
  read-only lifecycle/tick values, restricted world capabilities, candidate handle
  ownership, deterministic showcase execution and the full Chaos run.
- `npm run typecheck`: passed. `tests/api-misuse.ts` verifies forbidden runtime
  exports, lifecycle/tick writes, foreign world/resource access, query membership
  changes and manual candidate consumption fail compilation.
- `npm run build`: passed, including the same API misuse fixture against emitted
  package declarations (`tsc -p tests/tsconfig.api.json`). The demo and hello build
  from the package's emitted ESM exports; development still resolves to source.
- Direct Node ESM import from `ngne`: restricted runtime names absent; scene
  preparation, spawn, tick, inspection, getter protection and disposal passed.
- `/validation.html`: all 13 checks passed, including the added browser frame-fault
  transition through the internal lifecycle capability.
- Production preview: Starfall launch, pause and resume passed; hello rendered its
  cyan rectangle. Neither production page reported console errors.
- `git diff --check`: passed.
- `npm run bench`: completed after migrating capacity inspection. ECS 20,000-entity
  median/p95: 0.374/0.512 ms; Chaos simulation/preparation: 0.668/0.971 ms,
  with 7,209 peak sprites and 6,986 slots. Same harness/method as below; CPU only,
  not a controlled before/after comparison or performance improvement claim.

The normal sandbox blocked the bundler's parent-directory lookup; the same build
passed with approved execution outside that filesystem restriction.

Documentation updated: implementation contract (complete public-symbol inventory,
inspection semantics and migration), README, authoring guide and roadmap. Architecture,
capabilities and decisions require no changes: the implementation enforces their
existing ownership rules. The v00 prototype remains untouched historical evidence.

These checks establish the local API change, not cross-device compatibility. No new
physical mobile/gamepad, Firefox/Safari, GPU timing or throughput claim is made.
Enumeration is diagnostic enumerable data, with the representation limits in the
contract; it is not a lossless snapshot or serialization format.

## Release preparation — 8 September 2026

Windows x64, Node v24.15.0, Chromium-based Codex browser:

- Clean `npm ci` succeeded after stopping local servers that locked dependency files.
- All 25 headless tests passed; strict TypeScript (including the new example) and the production build passed.
- Built ESM engine imported independently; a spawn/commit/query/dispose smoke check passed.
- All 12 `/validation.html` checks passed, including WebGL context restoration.
- Production game launch, pause and resume passed. The first-scene production page loaded without console errors.
- Desktop production layout inspected. Physical mobile testing remains outstanding.
- Gameplay screenshot captured from Chaos Lab. No new universal FPS or GPU performance claim is made.

Fresh CPU benchmark: 20,000-entity ECS median **0.239 ms**, p95 **0.444 ms**; Chaos simulation/preparation median **0.658 ms**, p95 **0.931 ms**. Peak: 7,209 sprites and 6,986 entity slots. These measurements exclude GPU submission, display and input polling.

GitHub Actions repeats headless tests, typechecking and the build. Browser validation and benchmarks remain explicit local checks.

## Original baseline — 7 September 2026

Local verification on 7 September 2026, Windows x64, Node v24.15.0, Chromium-based Codex browser. These are local observations, not cross-device guarantees.

## Automated checks

- 25 headless tests: entity visibility, churn, stale/foreign handles, query stability, input edges, fixed-step overload, deterministic RNG, committed state, freeze/events, suspension, scene command failure, private cleanup, setup restrictions, stop/resume, startup failure, terminal disposal, shared asset cancellation, camera and draw order, scoped audio and complete gameplay.
- Two equal-seed games produce identical normalized simulation enumerations after 600 ticks.
- An 11,000-tick Chaos Lab check completes the three-minute run, commits a victory and score, and stays below 20,000 entity slots.
- Strict TypeScript and production build pass; emitted engine declarations are separate from the bundled game.

## Real browser checks

`/validation.html` passed all 12 checks:

1. Layer order independent of submission order.
2. Scene order takes precedence over local layer.
3. Correct source-alpha pixel compositing.
4. Decoded texture upload and UV sampling.
5. 10,000 synthetic sprites in one instanced draw.
6. No WebGL error after buffer growth.
7. Safe submission skip during deliberate context loss.
8. Shader, buffer and texture restoration after context recovery.
9. Browser host drives fixed simulation.
10. Late stopped callbacks perform no work.
11. Resume preserves scene identity and resets wall-clock accumulation.
12. Browser teardown completes.

Game UI: desktop and 390px mobile viewport inspected; no horizontal overflow in the measured mobile document. Start, pause and resume render the correct states. Sound toggle accepts the gesture and switches state. The production preview also passed launch and resume; Space triggered a nova and its recharge counter was observed. Original pixel artwork renders; console had no application errors. Audio graph behavior has automated coverage; subjective audio quality and physical gamepad/touch operation are not claimed verified.

## Performance

CPU benchmark (`npm run bench`), 100 warmup iterations, then 300 ECS samples; chaos samples exclude the first 101 of 900 ticks:

| Workload                                        |   Median |      p95 |
| ----------------------------------------------- | -------: | -------: |
| Update 20,000 entities with position + velocity | 0.240 ms | 0.503 ms |
| Chaos simulation + frame preparation + sort     | 0.656 ms | 0.917 ms |

The chaos benchmark reached 7,209 sprites and 6,986 entity slots. These CPU numbers exclude input polling, WebGL upload/submission, GPU execution, DOM presentation and display synchronization.

Actual game: ten DOM telemetry samples, one second apart, while Chaos Lab was active:

| Metric                                           | Observed              |
| ------------------------------------------------ | --------------------- |
| Smoothed display FPS                             | 60 in all ten samples |
| Sprites                                          | 6,456–6,590           |
| Draw calls                                       | 2                     |
| Reported CPU frame work                          | 1.4–8.2 ms            |
| Additional dropped ticks during sampled interval | 0                     |

The cumulative dropped counter was already 9 at the start and remained 9. These observations do not prove zero stalls, GPU timings, or a p95 distribution; the UI reports individual CPU samples and smoothed FPS. The earlier counter includes activity before the sampled interval. Development hot reload, backgrounding, and browser tooling can affect frame timing.

## Limits

No mobile hardware, physical gamepad, Firefox or Safari run was performed. WebGL 2 is required. Save/restore, replay controllers, networking, editors, local multiplayer and other explicitly deferred capabilities were not implemented. The process and source audit are recorded in the v00 prototype audit; see the NGNE-18 entry for its Git recovery revision.
