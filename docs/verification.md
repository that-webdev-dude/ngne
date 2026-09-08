# NGNE verification

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
- Mechanical format: **45 files** rewritten in a separate commit with no other
  change. `git diff -w --numstat` over that commit is 1,097 added / 761 removed
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
