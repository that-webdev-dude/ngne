# NGNE-12 session 1: measure and diagnose the SoA and WebGPU migration

Planning date: 14 September 2026. Proposal only; execution starts in a new session after the user
approves this plan. Review rounds, dispositions and the approval hash are in
[the review log](NGNE-12-review-log.md).

Jira: [NGNE-12](https://thatwebdevdude.atlassian.net/browse/NGNE-12), updated on the planning date.
Its required work, acceptance criteria and validation are the source of truth. NGNE-27 is Done.
NGNE-13 (CI) and NGNE-14 (device matrix) stay separate.

This plan covers **session 1 only**: measurement, diagnosis and, if the user selects fixes, the
approved session 2 plan. Session 1 changes no engine, game, example or page code.

## Goal and acceptance

Measure the whole migration (R0→R2), attribute it across its intermediate revisions, on the same
machine, browser, seeds, warmup and duration, and identify regressions with evidence strong enough
to fix or accept.

| #   | Acceptance criterion (Jira, session 1 share)                                                         | Phase | Proof                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------- |
| S1  | Before/after table identifies revisions, workloads and numeric (f32/f64) differences                 | 2–4   | `docs/verification.md` NGNE-12 section                                                  |
| S2  | Sustained churn and repeated scenes expose retained memory and frame-time distributions, both games  | 3, 4  | Replicated sustained runs, cycle runs with state oracles, snapshot diffs                |
| S3  | SoA updates/churn, frame preparation and GPU upload/render work measured, CPU separated from GPU     | 2, 3  | Split Node arms, renderer fixture, GPU evidence per [GPU evidence](#gpu-evidence)       |
| S4  | Allocations/GC and retained memory reported as distinct metrics; peak buffers/caches told from leaks | 3, 4  | Allocation sampling, GC trace events, forced-GC retained heap, cache cardinality checks |
| S5  | Claims separate local evidence from universal performance; every regression is explicit and ranked   | 4     | Regression table built by the predeclared rules                                         |
| S6  | Selected fixes have an approved session 2 plan, or the user accepts every regression and gap         | 5     | `plans/NGNE-12-fixes.md` approved by Codex, or accepted list in verification            |

The Jira criterion "each selected regression is fixed with A/B evidence" belongs to session 2.
NGNE-12 is complete only when session 2 finishes, or when session 1 ends with no fixes selected
**and** no required evidence gap is left unwaived by the user.

## Revisions

| Id  | Revision                                            | State                                                                                                  |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| R0  | `a906f3a`                                           | Last revision before SoA and WebGPU (NGNE-20 base): object ECS, WebGL renderer                         |
| RS  | `9c00f02`                                           | NGNE-20: schema SoA API added; games still on the rewritten legacy object path (object columns); WebGL |
| R1  | `12b727e`                                           | NGNE-21 added: WebGPU renderer, shared browser/asset path, 14-float `Frame`; both games still on WebGL |
| R2  | `86494fd`, or a later HEAD touching only docs/plans | Both games on schema ECS and WebGPU; WebGL and bridge removed (NGNE-27)                                |

| Pair  | Attributes                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------ |
| R0→R2 | Whole migration                                                                                  |
| R0→RS | NGNE-20 rewritten legacy object path and shared bookkeeping (not object-versus-SoA)              |
| RS    | Object-versus-schema storage cost (same-revision churn matrix, the causal SoA comparison)        |
| RS→R1 | NGNE-21 shared path and `Frame` widening, games still on WebGL                                   |
| R1→R2 | Game ports, bridge and WebGL removal, WebGPU in the games                                        |
| R1    | WebGL vs WebGPU renderer on identical fixed input (renderer fixture, both modes in one revision) |

RS runs in the Node matrices. It joins a browser comparison only through a fresh R0/RS/R1 submatrix
for a workload where R0→R1 is attributable, so browser machine time stays bounded. The NGNE-26 revisions (`6e14e2e`,
`058c559`) predate NGNE-7/9/10 and are historical context only.

## Assumptions and decisions

| Decision                                                                                                                                                                 | Evidence (verified 14 Sept 2026)                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| R0, RS, R1 and R2 contain Starfall, the platformer, `tests/benchmark.ts` and `tests/browser-baseline.ts` with platformer mode.                                           | `git ls-tree a906f3a tests/ examples/`; `git show a906f3a:tests/browser-baseline.ts` line 21. Phase 0 re-verifies RS. |
| Node CPU arms use one script text copied unchanged into each export, as in NGNE-27, except arms whose API differs by revision (stated per arm).                          | NGNE-27 `chaos-only.ts` ran unchanged on `a906f3a`, `9c00f02`, `12b727e` and the migrated tree.                       |
| Browser runs use one driver, the phase 1 `tests/browser-baseline.ts`, against every revision's production preview. It observes and never edits the page.                 | It injects a rAF wrapper, heap sampler and CDP calls only.                                                            |
| The existing driver ignores CDP events and samples allocations only in renderer mode; phase 1 must add event handling and game-mode sampling.                            | `tests/browser-baseline.ts:130` (`send` only) and `:173` (`if (IS_RENDERER)` before `HeapProfiler.startSampling`).    |
| The renderer fixture exists with `webgl` and `webgpu` modes at R1 and `webgpu` only at R2; R0 and RS have no fixture.                                                    | `git show 12b727e:tests/browser-renderer-benchmark.ts` line 25; absent at `9c00f02`.                                  |
| The engine requests no optional WebGPU features, so GPU execution timing (`timestamp-query`) is unavailable without an engine change.                                    | `src/gpu-context.ts:30` calls `adapter.requestDevice()` with no descriptor; features must be requested there.         |
| NGNE-27 R1→R2 leads are hypotheses to re-measure, not arms: Starfall churn 2.4→7.8 MiB/s, heap max 11.4→17.7 MiB, +1.9 MiB retained per 60 s, 7–12% slower Chaos window. | `docs/verification.md` NGNE-27 phase 5. NGNE-26 measured about 7 MiB/s at an earlier revision, so R0 decides.         |
| `npm run bench` Chaos is not a pre/post A/B (preceding ECS workload in-process); only fresh-process arms are compared.                                                   | NGNE-27 phase 5 note.                                                                                                 |
| One target: Windows 11, i7-12650H, Chrome 152 headful over CDP, Intel `gen-12lp`, DPR 1, localhost, mains power. No in-app Browser pane.                                 | NGNE-27 environment; the hidden pane stops drawing.                                                                   |

## Model and session setup

- **Builder and investigator:** Claude Opus, high effort. It runs every measurement, writes the
  analysis, the verification section and the session 2 plan.
- **Inspector:** Codex `gpt-5.6-sol`, read-only, a fresh session that did not build:
  `codex exec -m gpt-5.6-sol -s read-only`; resumes add `-c sandbox_mode="read-only"` and repeat
  `-m gpt-5.6-sol`. Never `gpt-6-astra`. If Codex is unavailable after one retry, stop and tell the
  user; never swap model or provider.
- **Optional helper:** a Sonnet subagent may run already-specified batches (repeat runs, manifests,
  table formatting). It never interprets results, rejects samples or edits tracked files.
- **Protocol:** one phase at a time. Run the phase gate, send the stop report, wait for the user's
  explicit validation before the next phase.

## Stop and escalate

Stop, report and wait when:

- **Any change to `src/`, `demo/`, `examples/`, `index.html` or `validation.html` would be needed**,
  including diagnostic instrumentation or a build marker. Record it as a session 2 candidate.
- **A workload cannot run identically on every revision in its matrix** (missing control, changed
  element id, incompatible import, no observable state oracle). Report it as not comparable with the
  reason; never adapt one revision's page or game.
- **Noise hides a comparison** after the planned repeats (see [noise rule](#order-replication-and-attribution)).
  Report the narrowed claim or abandoned comparison; never drop runs to reach a verdict.
- **Environment evidence contradicts the plan**: browser version, adapter or active backend differs
  from the expected one, software fallback, visibility change, served build not the intended export,
  machine not idle.
- **A predeclared rule would be changed after seeing data.**
- **Scope creep**: fixes, CI timing gates (NGNE-13), other devices (NGNE-14).

## File ownership

| Path                          | Phase | Change                                                                                                                                         |
| ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/browser-baseline.ts`   | 1     | Run isolation and served-build check, backend assertion, CDP events, game allocation sampling, long-task window, cycle mode, snapshots, traces |
| `docs/verification.md`        | 0–5   | New top `## NGNE-12` section; prior sections untouched                                                                                         |
| `docs/roadmap.md`             | 4, 5  | NGNE-12 status                                                                                                                                 |
| `plans/NGNE-12-fixes.md`      | 5     | Session 2 plan, only if the user selects fixes                                                                                                 |
| `plans/NGNE-12-review-log.md` | 5     | Append-only; already holds this plan's review rounds; phase 5 appends the session 2 plan rounds                                                |

`tests/benchmark.ts` is not changed: new Node arms are standalone scripts so no arm inherits another
arm's warm state. Everything else stays byte-identical. Raw diagnostics, exports, scripts, profiles,
snapshots and traces live outside the checkout in
`C:/Users/jfabi/AppData/Local/Temp/ngne-12-diagnostics/`.

## Measurement methods

### Provenance and run isolation

- Every raw result has a `<result>.manifest.txt` sidecar: measured tree and its `EXPORT_REVISION`
  (or `git rev-parse HEAD`), `git status --porcelain`, SHA256 of `git diff HEAD`, SHA256 of each
  untracked file, SHA256 of every harness script used, the command line, and for browser runs the
  preview port and PID, Chrome PID, CDP port, profile directory and served-build hash.
- Exports: `git archive` of R0, RS, R1 and R2 into the diagnostics directory with `EXPORT_REVISION`,
  `npm ci` and `npm run build` in each. NGNE-27 exports may be reused only if `EXPORT_REVISION` matches
  and `npm ci` and the build are rerun. Record the SHA256 of each export's `dist/` asset list.
- Each browser run: a distinct preview port started with `--strictPort`, a unique CDP port and fresh
  profile directory, both processes owned by the run and terminated after it, with a check that no
  owned process survives. Before warmup the driver fetches the served `index.html` and entry assets
  and verifies their hashes against the intended export's `dist/`; a mismatch aborts the run.
- Active backend: the driver records `WEBGL_debug_renderer_info` from a probe canvas and the page's
  own context type for R0/RS/R1 pages, and WebGPU adapter info for R2 and the fixture's `webgpu` mode.
  The run is rejected if the backend is not the expected one, the renderer string names a software
  rasteriser (SwiftShader, WARP, llvmpipe) or the adapter reports `isFallbackAdapter: true`.

### Order, replication and attribution

- Fresh process (Node) or fresh browser launch per run. A **matrix** is a set of k conditions
  (revisions or modes) measured together. It runs as a k×k Latin square, one block per row, so each
  condition occupies each position once; the square repeats until every condition has at least 3
  accepted runs (k = 2: two squares, 4 runs each). A rejected run rejects its whole block: the complete
  row is rerun and every raw result of the rejected block is kept. Attribution uses only runs from one
  matrix.
- **Replicated** workloads (fixed matrices):

    | Matrix                              | Conditions                                                   | Runs each |
    | ----------------------------------- | ------------------------------------------------------------ | --------- |
    | `chaos-split.ts` timing             | R0, RS, R1, R2                                               | 4         |
    | `churn-object.ts` timing            | R0, RS, R1                                                   | 3         |
    | `churn-schema.ts` timing            | RS, R1, R2 (where the schema API runs)                       | 3         |
    | Same-revision churn (causal SoA)    | RS object, RS schema                                         | 4         |
    | `width-pass.ts`                     | R2 (paired in-process, alternating order)                    | 3         |
    | Starfall Chaos Lab 60 s             | R0, R1, R2                                                   | 3         |
    | Platformer idle 60 s                | R0, R1, R2                                                   | 3         |
    | Renderer fixture, one texture       | R1 webgl, R1 webgpu, R2 webgpu                               | 3         |
    | Renderer fixture, alternating       | R1 webgl, R1 webgpu, R2 webgpu                               | 3         |
    | RS browser submatrix (if triggered) | R0, RS, R1, fresh, for the triggering workload               | 3         |
    | Confirmation (if triggered)         | R0, R1, R2, fresh, for the triggering long or cycle workload | 3         |

- The churn allocation-sampling and `--trace-gc` modes are separate runs that repeat with the same
  conditions, Latin square and run counts as their timing matrix.
- **Descriptive** workloads (1 run per condition, never a verdict alone): 300 s Starfall and both cycle
  workloads on R0 and R2 only; GPU trace runs on R0, R1, R2 and the fixture modes. A leak candidate, or
  any leak or bounded-cache classification that will inform a fix-or-accept decision, triggers the
  confirmation matrix within phase 3; the descriptive run is excluded from attribution. GPU trace
  metrics, including browser GC pauses from trace events, are descriptive only and never enter the
  regression classification.
- The RS browser submatrix is triggered when a 60 s workload shows R0→R1 attributable on any decision
  metric.
- **Attributable difference (pair X→Y, per metric)**: every Y run value is above every X run value (or
  every one below, for an improvement) and the gap between the medians of the run values exceeds the
  larger same-revision range. Applied separately to each decision metric: p50, p95 and p99 time,
  allocation rate, reclaimed rate, GC pause total, retained-heap slope, dropped ticks. Otherwise
  **within run noise**.
- **Noise stop:** a same-condition range above 10% of its median for a decision metric in a
  completed matrix. More repeats cannot shrink a range, so the comparison for that metric is either
  narrowed (reported as within run noise with the observed ranges) or abandoned; it never yields a
  regression verdict.
- **Regression**, R0→R2, only if attributable and at least one of: CPU p50 or p95 +5% (attributable
  window), browser callback p95 +10%, allocation rate +25% (browser sampling or Node churn), GC pause
  total +25% (Node churn `--trace-gc` matrices only), dropped ticks above 0 in every Y run and no X run,
  or a **confirmed leak** (see [scene and asset cycles](#scene-and-asset-cycles)). Attributable but smaller is **minor**,
  recorded and not ranked.
- Every regression is attributed across R0→RS, RS→R1 and R1→R2 where a matrix provides those pairs;
  missing pairs are named. Object-versus-schema storage cost is attributed only by the same-revision
  churn matrix.
- Rejected samples keep raw files with a `.rejected` suffix and a one-line reason and are listed.

### Node CPU arms

- **Chaos split:** a new `chaos-split.ts` derived from the NGNE-27 `chaos-only.ts` (verify its SHA256
  prefix `66e2e84bbfc1`; if missing, rewrite from the NGNE-27 plan method and say so). Same workload:
  `arena({ stress: true })`, seed `bench`, 900 ticks at alpha 0.5, samples 101–899. It times
  simulation (`tick`), frame preparation (`render` into `Frame`) and `sort` separately per sample, plus
  their sum, and prints distributions for each. One script text for R0, RS, R1, R2.
- **Attributable windows:** rerun `parity-probe.ts` (SHA256 prefix `73e3f5de606e`) on Chaos and
  Starfall normal in every export. A pair's window is the longest tick prefix with identical hash
  lists. Outside it, results are non-attributable whole-game evidence.
- **Structural churn:** two standalone fresh-process scripts with equivalent work: `churn-object.ts`
  (object-component API: native at R0, the legacy bridge at RS and R1) and `churn-schema.ts` (schema
  API at RS, R1, R2). Same entity count, component shapes, spawn and despawn counts per commit, commit
  cadence, warmup and samples; the equivalence table goes into the verification section in phase 0.
  The **causal SoA comparison** is the same-revision RS object-versus-schema matrix; R0→RS on
  `churn-object.ts` measures NGNE-20's rewritten legacy path and shared bookkeeping, not SoA.
    - Timed runs report per-commit time only.
    - Separate allocation runs sample allocations in-process through `node:inspector`
      `HeapProfiler.startSampling` (GC-collected objects included) over the sampled commits and reports
      sampled bytes per second.
    - Separate `--trace-gc` runs report GC count and pause total.
    - Both repeat with the timing matrix's conditions and run counts.
    - Heap after `--expose-gc` forced GC every 100 commits is reported strictly as retained memory.
- **f32/f64 pass:** standalone `width-pass.ts` on R2: the
  20,000-entity position/velocity pass with `f32` and `f64` fields, paired per sample with the order
  alternating by sample (f32 first on even samples, f64 first on odd). Not run on R0, which has no
  schema storage.
- **CPU profiles:** one separate profiling run of `chaos-split.ts` per revision with a
  `--profile-window W` option that starts `node:inspector` `Profiler` at tick 101 and stops it after
  tick `W` (the pair's attributable window; one run per distinct `W`). Self time by function,
  summarised by `profile-summary.mjs` or a successor with a recorded SHA256. Profiling runs are never
  timing evidence.
- **`npm run bench`:** twice per revision for the historical record only, labelled not an A/B.
- **Numeric differences:** every Starfall and platformer schema field with type and bytes per row at
  R2 against R0 JS numbers; where `Frame` narrows to `Float32Array` in all revisions.

### Browser sustained runs

Production preview per export, headful Chrome 152 via the phase 1 driver, 10 s warmup then sampling,
window visible, machine idle on mains power (user confirms before each block).

Durations: 60 s workloads and the renderer fixture use 10 s + 60 s; the long Starfall run uses
10 s + 300 s; cycle runs last 5–10 minutes; GPU trace runs use 10 s + 60 s. Conditions and run counts
are the replicated and descriptive matrices in [order, replication and attribution](#order-replication-and-attribution).

Per run, as separate metrics:

- **Time:** frame interval and callback distributions (callback includes host DOM telemetry in every
  revision; say so), intervals over 25 ms, dropped ticks during the sample.
- **Long tasks:** only entries whose `startTime` falls inside the sample window.
- **Allocation:** `HeapProfiler.startSampling` in every game mode with
  `includeObjectsCollectedByMajorGC` and `includeObjectsCollectedByMinorGC`, over the sample window;
  total sampled bytes per second and top sites. The full profile is kept unfiltered. Phase 0 builds
  each export's Vite bundle with hidden source maps and checks the JavaScript assets are byte-identical
  to the plain build; if so the hidden-map build is served and sites are source-mapped, otherwise the
  plain build is served, sites keep bundle positions and a source function is named only where its
  identity is unambiguous.
- **Reclamation:** heap drops from the 250 ms `performance.memory` series, labelled a lower-bound proxy.
- **GC:** count and total pause from V8 GC trace events in the descriptive trace run, and heap-drop
  counts from `performance.memory` in timed runs, labelled by source; descriptive only.
- **Retained:** heap after forced GC at sample start and end, and its slope for long runs.
- **Renderer fixture:** CPU preparation and CPU submission separately, as in NGNE-21.

### Scene and asset cycles

- Phase 0 defines one cycle per game using controls present and identical in R0, R1 and R2, and a
  **completion oracle** per cycle step observable without page changes (DOM text such as
  `#flight-state` or `#overlay-title` for Starfall; the platformer's DOM status elements), with a
  timeout. A step without an observable oracle makes the workload not comparable (stop).
- It also records the **expected cardinalities** after each completed cycle: mounted scenes, live
  entities or sprites where the HUD exposes them, decoded image assets, audio buffers, and WebGPU
  textures and buffers where observable from the heap snapshot. Each intentional cache (decoded asset
  cache after leases reach zero, renderer-owned textures, pooled buffers) is listed with its expected
  bound and the constructor or retainer that identifies it in a snapshot.
- Cycle mode runs N cycles (N set so a run lasts 5–10 minutes), verifying every oracle, with a forced GC
  and retained-heap reading every N/10 cycles and heap snapshots after the first and last checkpoints.
- **Leak candidate:** after the first checkpoint, the least-squares slope of retained heap across
  checkpoints is positive with total growth above 1 MiB, and the snapshot diff attributes growth to
  constructors or retainers whose count grows with cycle count and that are not a listed cache within
  its bound. **Bounded cache or peak:** the slope over the last half of the checkpoints is not
  positive beyond 0.05 MiB per checkpoint, and every grown constructor is a listed cache within its
  bound. Anything else is **unclassified** and reported as such.
- A descriptive run yields only a candidate or a descriptive classification. In the confirmation
  matrix, leak presence is recorded per revision (the leak rule holds in every run of that revision). A
  **confirmed leak** means R2 has leak presence and its retained-heap slope is attributably above R0's
  by the attribution rule, whether or not R0 also leaks. A **confirmed bounded cache** needs the bounded
  rule in every R2 run of that matrix.
- Snapshot diffs: a script in the diagnostics directory reports constructor, count delta, retained-size
  delta and top retainer path.

### CDP artifacts

- The phase 1 driver dispatches CDP events, not just responses. Heap snapshots collect
  `HeapProfiler.addHeapSnapshotChunk` until `takeHeapSnapshot` resolves; traces use
  `Tracing.start` with `transferMode: "ReturnAsStream"` and read the stream after
  `Tracing.tracingComplete`.
- Gate for every snapshot, trace and allocation profile: non-empty, parses as JSON, node or event
  count above zero and recorded, SHA256 recorded. A failed artifact rejects the run.

### GPU evidence

- **Renderer fixture (primary, replicated):** fixed input, CPU preparation and CPU submission
  separately, WebGL vs WebGPU inside R1 and R1 WebGPU vs R2 WebGPU.
- **GPU-process trace (descriptive):** one run per revision and fixture mode with the `gpu`,
  `disabled-by-default-gpu.dawn`, ANGLE and `v8` GC categories Chrome 152 exposes (exact list recorded).
  Phase 0 proves, on one short run per backend, that the categories yield per-frame events that can be
  aligned to rAF frames and names the events compared. Labelled "GPU-process CPU time; not GPU
  execution time".
- **GPU execution time:** unavailable without an engine change. Phase 0 records whether
  `adapter.features` has `timestamp-query` on this machine. This is a **required evidence gap**: it is
  either planned as a session 2 item or explicitly waived by the user in phase 5; NGNE-12 cannot be
  marked done with it silently open.
- If phase 0 cannot prove alignment for the trace, the trace is dropped and recorded as unavailable;
  the fixture remains the GPU-side evidence.

## Phases

A phase that fails its gate is fixed within the phase (at most two attempts) or stopped and reported.

### Standard gate

```powershell
npm.cmd test              # all pass; report count
npm.cmd run typecheck     # exit 0
npm.cmd run build         # exit 0
npm.cmd run format:check  # exit 0
git diff --check          # no output
```

Protected-path scan (Git Bash): `git diff --name-only 86494fd -- src demo examples index.html
validation.html` returns nothing.

### Stop report (every phase)

1. Changed files.
2. Each gate command with exact result or count.
3. Evidence recorded and where, with manifests; rejected samples.
4. `MANUAL (user)` checks pending, with steps and pass criteria.
5. Open decisions.

### Phase 0 — Entry, exports and definitions

- **Entry:** plan SHA256 matches the review log; HEAD is `86494fd` or a later commit touching only
  `docs/` or `plans/`; `git status --porcelain` is empty or shows only this plan and its review log;
  Jira NGNE-12 re-read (material change: stop); `codex --version` works.
- **Work:**
    1. Diagnostics directory; exports R0, RS, R1, R2 with `npm ci`, build and `dist/` hashes; manifest
       helper.
    2. Environment: OS, CPU, RAM, Node, npm, Chrome version, adapter info and features
       (`timestamp-query`), power plan and mains power.
    3. Confirm `chaos-only.ts`, `parity-probe.ts` and `profile-summary.mjs` SHA256 prefixes, or plan rewrites.
    4. `parity-probe.ts` on Chaos and Starfall normal in all exports; attributable windows for every pair.
    5. Churn equivalence table; cycle definitions, completion oracles, expected cardinalities, cache
       list and N; GPU trace categories with the alignment proof or its failure.
    6. Load each preview once (not timed) to verify every control, oracle and backend string.
- **Gate:** exports build; windows recorded; definitions verified on every preview; the NGNE-12
  section has revisions, environment, windows and all definitions, written before any timed data;
  standard gate; protected-path scan empty.
- **MANUAL (user):** none.

### Phase 1 — Harness

- **Work:** extend `tests/browser-baseline.ts` per the file ownership row, behind environment-variable
  options; with no new options, the existing 10 s + 60 s run keeps its output fields (new fields may be
  added). Write `chaos-split.ts`, `churn-object.ts`, `churn-schema.ts`, `width-pass.ts` and the
  snapshot-diff script in the diagnostics directory.
- **Gate:** standard gate; smoke runs (5 s) of every new driver mode against R2 and of cycle mode and
  backend assertion against R0 and R1, each producing valid artifacts per [CDP artifacts](#cdp-artifacts);
  a deliberate wrong-port run aborts on the served-build check; each Node script runs once on every
  revision it targets.
- **MANUAL (user):** none.

### Phase 2 — CPU measurements

- **Work:** the Node matrices from [order, replication and attribution](#order-replication-and-attribution);
  separate churn allocation and GC runs; windowed profiling runs; bench twice per revision;
  numeric-field inventory.
- **Gate:** manifests for every raw result; attribution computed per pair and per metric inside each
  window and whole-run; profile summaries name the functions accounting for any attributable window
  difference above 5%; tables in the verification section.
- **MANUAL (user):** confirm the machine stays idle during the block (no builds, CI or other load).

### Phase 3 — Browser measurements

- **Work:** the browser matrices (60 s games, both renderer fixture matrices), then the descriptive
  runs; the RS submatrix for any 60 s workload with R0→R1 attributable; a confirmation matrix for any
  descriptive candidate.
- **Gate:** every accepted run has 0 visibility changes, the served-build and backend checks passed, a
  manifest and valid artifacts; every cycle oracle passed; rejected runs listed; leak/cache/unclassified
  computed by the predeclared rule; tables in the verification section.
- **MANUAL (user):** before each block, keep the Chrome window visible and unobstructed and the
  machine idle on mains power; confirm afterwards that nothing interrupted it. The executor states each
  block's machine time before starting it; expect about 2 hours for the fixed matrices and descriptive
  runs, plus about 45–90 minutes per triggered confirmation matrix, split across blocks.

### Phase 4 — Analysis, documentation and inspection

- **Entry:** ask the user once to authorize commit S1-C1 and whether to push it.
- **Work:**
    1. `docs/verification.md`: before/after tables per workload and metric; regression table with
       classification, size, per-pair attribution, cause evidence (profile functions, allocation sites,
       snapshot retainers), confidence, proposed fix direction and a proposed closure target; minor and
       within-noise results; evidence gaps (GPU execution time, anything not comparable); local limits
       (one machine, one GPU, one browser).
    2. Rank regressions by effect on frame-budget headroom and on memory over a 10-minute session.
    3. `docs/roadmap.md`: NGNE-12 measured; fixes pending the user's selection.
    4. Fresh read-only Codex inspection of the session 1 diff, the raw-result manifests and artifacts
       against this plan (rules applied as predeclared, blocks balanced, no dropped runs, claims no
       stronger than evidence, protected paths untouched). Fix findings and resume the same session
       until **APPROVED**.
    5. Record the inspection rounds. `npm run format`, standard gate, commit S1-C1
       `[NGNE-12] <message>`; push only as authorized.
- **Gate:** Codex APPROVED; standard gate; protected-path scan empty.
- **MANUAL (user):** read the regression table and the evidence gaps.

### Phase 5 — Decision and session 2 plan

- **Entry:** phase 4 validated. Ask the user which regressions to fix, which to accept, and for each
  evidence gap whether to plan it (for example `timestamp-query` GPU timing) or waive it.
- **If nothing is selected and every gap is waived:** record the decisions in the verification section,
  mark NGNE-12 done in `docs/roadmap.md`, standard gate, Codex read-only inspection of the docs-only
  delta, commit S1-C2; push only as authorized. Jira stays untouched.
- **Otherwise:** write `plans/NGNE-12-fixes.md` per the requirements below and run the adversarial plan
  review with Codex `gpt-5.6-sol` read-only, same session across rounds, until **APPROVED** or 5 rounds
  (then stop and report). Append each round and its dispositions to `plans/NGNE-12-review-log.md`.
  Run Prettier on the plan before hashing; Codex confirms the formatted SHA256. Record the decisions in
  the verification section. Commit S1-C2 with the plan, review log and docs; push only as authorized.
  Do not start session 2.
- **Gate:** one branch complete; standard gate; protected-path scan empty.

## Session 2 plan requirements

`plans/NGNE-12-fixes.md` must contain, for the session 2 executor:

- **Inputs:** session 1 final SHA, plan SHA256, exports and scripts to reuse (with SHA256), the
  diagnostics directory, the Jira key, and the session 1 regression table rows being fixed.
- **Per selected item, one phase in rank order**, each with:
    - cause evidence from session 1, hypothesis, files and exact scope, affected contract or API
      sections (any public API change escalates);
    - a predeclared **closure target** (for example allocation rate back within the R0 range, or
      CPU p50 within the R0 attributable-window range) and **non-inferiority bounds** for every other
      session 1 decision metric, as absolute numbers derived from session 1 ranges;
    - an isolated A/B: the phase's parent commit against its child, same harness, windows, balanced
      blocks, replication and attribution rules as session 1; plus a cumulative comparison of the child
      against the R2 export;
    - replicated evidence for every affected workload (browser, cycle, fixture, GPU) named in the phase;
    - the parity-hash oracle for any `src/ecs.ts`, `Frame` or game simulation change; the standard gate;
      `validation.html` in headful Chrome over CDP; `MANUAL (user)` play checks where behaviour could
      change.
- **Stop triggers:** closure target not met after two attempts; any non-inferiority bound breached;
  any change inside `Sprite`, `Frame` or `packAffine` not listed in the phase; parity mismatch; noise
  stop.
- **Model setup:** builder Claude Opus; inspector Codex `gpt-5.6-sol` read-only per phase before each
  commit; one commit per fix `[NGNE-12] <message>`; pushes as the user authorizes.
- **Closeout:** rerun the complete session 1 matrix for every workload any fix touched, replicated, on
  the final tree against R0 and R2; verification and roadmap updates; NGNE-12 done only after that.

## Verification contract

- Windows uses `npm.cmd`; Git Bash for scans with embedded quotes. Record fresh counts.
- Never reuse NGNE-26 or NGNE-27 numbers as comparison arms; cite them as history only.
- Browser work uses headful Chrome over CDP, never the in-app Browser pane.
- `MANUAL (user)` items are never simulated or marked passed without the user's confirmation.
- Repository files are written with the Edit/Write tools, not PowerShell `Set-Content`.
- Before any authorized commit: `npm.cmd run format`, review the diff, one-line
  `[NGNE-12] <message>`, no co-author.

## Documentation

| Owner                         | Update                                                                                         | Phase |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ----- |
| `docs/verification.md`        | Revisions, environment, windows, definitions, results, regressions, gaps, inspection, decision | 0–5   |
| `docs/roadmap.md`             | NGNE-12 status                                                                                 | 4, 5  |
| `plans/NGNE-12-fixes.md`      | Session 2 plan (conditional)                                                                   | 5     |
| `plans/NGNE-12-review-log.md` | Plan review rounds                                                                             | 5     |
