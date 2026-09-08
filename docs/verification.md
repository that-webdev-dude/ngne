# NGNE verification

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
  `prototypes/ngne/v00` is untouched.

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
`prototypes/ngne/v00` remain unchanged.

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
existing ownership rules. `prototypes/ngne/v00` remains untouched historical evidence.

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

| Workload | Median | p95 |
| --- | ---: | ---: |
| Update 20,000 entities with position + velocity | 0.240 ms | 0.503 ms |
| Chaos simulation + frame preparation + sort | 0.656 ms | 0.917 ms |

The chaos benchmark reached 7,209 sprites and 6,986 entity slots. These CPU numbers exclude input polling, WebGL upload/submission, GPU execution, DOM presentation and display synchronization.

Actual game: ten DOM telemetry samples, one second apart, while Chaos Lab was active:

| Metric | Observed |
| --- | --- |
| Smoothed display FPS | 60 in all ten samples |
| Sprites | 6,456–6,590 |
| Draw calls | 2 |
| Reported CPU frame work | 1.4–8.2 ms |
| Additional dropped ticks during sampled interval | 0 |

The cumulative dropped counter was already 9 at the start and remained 9. These observations do not prove zero stalls, GPU timings, or a p95 distribution; the UI reports individual CPU samples and smoothed FPS. The earlier counter includes activity before the sampled interval. Development hot reload, backgrounding, and browser tooling can affect frame timing.

## Limits

No mobile hardware, physical gamepad, Firefox or Safari run was performed. WebGL 2 is required. Save/restore, replay controllers, networking, editors, local multiplayer and other explicitly deferred capabilities were not implemented. The process and source audit are recorded in `prototypes/ngne/v00/AUDIT.md`.
