# NGNE verification

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
