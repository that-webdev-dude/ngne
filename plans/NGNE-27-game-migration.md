# NGNE-27: migrate Starfall and the platformer to SoA and WebGPU

Planning date: 13 September 2026. Proposal only; implementation is not authorized by this
planning task. Review rounds, dispositions and the approval hash are in
[the review log](NGNE-27-review-log.md); the executor brief is [the handoff](NGNE-27-handoff.md).

Jira: [NGNE-27](https://thatwebdevdude.atlassian.net/browse/NGNE-27), read live on the planning
date. Its required work, acceptance criteria, validation and documentation lists are the source
of truth. NGNE-15, NGNE-20 and NGNE-21 are Done. NGNE-12 (sustained comparison), NGNE-13 (CI) and
NGNE-14 (device matrix) are blocked by this ticket and stay separate.

## Goal and acceptance

Port the two real consumers to schema-defined typed-array components and the WebGPU renderer,
delete the legacy WebGL `Renderer`, the temporary renderer option and the object-component
bridge, replay the NGNE-15/9/10/6 regression cases on the new stack, close the four NGNE-20
follow-ups and record comparable before/after evidence.

| #   | Jira acceptance criterion                                                                                                                    | Phase      | Proof                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| A1  | Both games complete their playthroughs on SoA and WebGPU with no private imports                                                             | 2, 3       | Headless parity oracles, browser playthroughs including Starfall run to result and "Fly again", manual runs, import scan |
| A2  | No production WebGL backend remains; the deployed showcase runs on WebGPU                                                                    | 4, 6       | Source scan and production preview (4); live Pages URLs after an authorized push (6)                                     |
| A3  | NGNE-9 and NGNE-10 cases pass on the new stack; NGNE-6 interpolation regressions still pass                                                  | 2–4        | Replayed case lists from `docs/verification.md`, `validation.html`, `tests/interpolation*.ts`                            |
| A4  | `docs/guide.md` and example READMEs reflect migrated usage                                                                                   | 2–5        | Doc diff review against the migrated code                                                                                |
| A5  | Focused ECS tests: same-query nesting, inner-traversal commit rejection, `entityAt()` identity, exact null/live/stale reference records      | 1          | New `tests/ecs-soa.test.ts` cases                                                                                        |
| A6  | Chaos workload labelled precisely; NGNE-20 delta attributable or unexplained; per-epoch descriptor cost included or deferred                 | 0, 1, 3, 5 | Chaos-only fresh-process A/B, paired epoch traversal arm, `docs/verification.md` record                                  |
| A7  | Ownership inventory names schema chunk order/reuse, chunk-relative locations, field-record inspection, immutable definitions and descriptors | 1          | `docs/contracts/NGNE.md` diff                                                                                            |

NGNE-27 is complete only when phase 6 passes. Until then A2 is recorded as "production build
verified, deployment pending", and the roadmap must not mark NGNE-27 done.

## Assumptions and decisions

| Decision                                                                                                            | Evidence (verified 13 Sept 2026)                                                                                                                                          | Consequence                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NGNE-27 removes all three temporaries: legacy `Renderer`, `BrowserOptions.renderer`, object bridge.                 | `docs/roadmap.md` "Next validation"; contract "Migration" and "Renderer"; `src/browser.ts:28-29` comment.                                                                 | Planned, documented breaking changes in phase 4. Not escalations.                                                                                                                                |
| `Frame` and `Sprite` stay in `src/renderer.ts`; only the WebGL `Renderer` class and its helpers are deleted.        | `Frame` is imported from `renderer.ts` by `src/quad-renderer.ts:12`, `src/webgpu-renderer.ts:2`, `src/webgpu-runtime.ts:4`, `tests/frame-values.ts:1` and WebGPU tests.   | No importer churn. The `Frame`/`Sprite`/`packAffine` text must stay byte-identical, which keeps `Frame.add` under V8's inlining budget without re-deriving bytecode.                             |
| Both games import only public `ngne` symbols today.                                                                 | `demo/main.ts:2`, `demo/game.ts:1-15`, `examples/platformer/*.ts` imports.                                                                                                | A1 import scan is a regression guard. Tests may keep deliberate internal imports (contract "Internal only"), e.g. `tests/platformer.test.ts` `QUAD_STRIDE`.                                      |
| Starfall atlas becomes an authored `ImageAsset`, no engine change.                                                  | `ImageAsset` is a public interface (`src/assets.ts:11`); contract allows custom image loaders with the marker; `arena()` already lists `options.atlas` in `assets`.       | `load` returns `createImageBitmap(makeAtlas(), { premultiplyAlpha: "none", colorSpaceConversion: "none" })`, `dispose` closes it. Manual upload after start (`demo/main.ts:252-258`) is deleted. |
| Simulation fields port to `f64`; booleans to `bool`; small integer enums (`kind`) to `u8`; packed colours to `u32`. | All current component fields are JS numbers/booleans (`demo/game.ts:19-45`, `examples/platformer/game.ts:17-28`). `Float64Array` stores identical IEEE doubles.           | Arithmetic stays bit-identical, so exact headless parity is a valid oracle. `f32` narrowing is an NGNE-12 optimization question.                                                                 |
| Iteration order is preserved per archetype only while it stays within one 512-row chunk.                            | Contract "Storage, lifetime, and order"; legacy swap removal is archetype-global (`src/ecs.ts:735`); Starfall crosses 512 moving rows by about tick 240 (reviewer probe). | Parity is exact inside a measured order window and determinism-only after it. See [parity oracles](#parity-oracles).                                                                             |
| Collision caches hold entity + chunk component view + row, never objects or raw arrays.                             | Contract "Chunk traversal and borrowing"; `demo/game.ts:131-142` object refs; platformer player aliases `examples/platformer/game.ts:150-151`.                            | Grid resource entries are borrowed for the update and rebuilt every update before probing; player access uses sparse `read`/`write` or per-update view lookup.                                   |
| NGNE-26 baselines predate NGNE-20/21; NGNE-21 Starfall/renderer samples predate the inlining fix.                   | `docs/verification.md` NGNE-26 and NGNE-21 sections; NGNE-21 review log "Final proofs".                                                                                   | Phase 0 re-captures WebGL baselines at the pre-build HEAD. Comparisons after phase 4 are otherwise impossible.                                                                                   |
| One real target: Windows 11, Chromium 152, Intel `gen-12lp` WebGPU, secure localhost.                               | NGNE-21 verification.                                                                                                                                                     | Record versions/adapter again in phase 0. No portability claim (NGNE-14).                                                                                                                        |
| Deployment happens only on push to `main` (`.github/workflows/ci.yml:26-48`).                                       | CI workflow.                                                                                                                                                              | Phase 6 runs only after the user commits and pushes (or explicitly authorizes the executor to).                                                                                                  |
| `spawn()` with no components and zero-argument `query()` survive bridge removal.                                    | Contract "Inspection and legacy bridge"; `tests/ecs-soa.test.ts` uses empty spawns as reference targets.                                                                  | Empty entities become a schema-mode empty archetype (chunk-relative rows, `fields: []`). Contract/inspection migration note in phase 4.                                                          |
| Tooling: gates use `git grep --untracked` (available in both shells), not `rg`.                                     | `rg` is not on the PowerShell path in the review environment.                                                                                                             | Every scan below is an exact `git grep` command.                                                                                                                                                 |

### Scope split with NGNE-12

| Stream                                                   | Stays in NGNE-27                                                                                                                                                       | Moves to / remains with NGNE-12 or NGNE-21 limits                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Game ports, WebGL and bridge removal, regression replays | All                                                                                                                                                                    | —                                                                                                                |
| Focused ECS tests, ownership inventory                   | All                                                                                                                                                                    | —                                                                                                                |
| Chaos attribution                                        | Precise label; fresh-process Chaos-only A/B of `a906f3a` vs `9c00f02` with a predeclared classification rule                                                           | Profiling-level root cause if the A/B says "attributable"                                                        |
| Per-commit-epoch descriptor reconstruction               | Included: paired first/second traversal arm; migrated Chaos commits every tick                                                                                         | Sustained whole-game isolation                                                                                   |
| Performance evidence                                     | Chaos-only interleaved A/B (pre-build export vs working tree) in phases 3–5; `npm run bench` x2; Starfall Chaos and platformer idle browser runs x2 each (10 s + 60 s) | Longer windows, leak analysis, multi-device matrix, WebGPU vs WebGL attribution                                  |
| NGNE-21 test gaps                                        | Only what migration exercises: Starfall atlas load/dispose and renderer-source lifetime across replacements; setup receives decoded `ImageBitmap` only                 | Image candidate refill, general host-hook lease counts, loss during replacement awaits: unchanged NGNE-21 limits |

No acceptance criterion is dropped. A6's descriptor cost is included, not deferred.

## Stop and escalate

The executor stops, reports and waits when:

- **A public API or contract change is needed** beyond the planned removals. In scope without
  escalation: phase 4 edits to `src/renderer.ts`, `src/browser.ts`, `src/ecs.ts`, `src/index.ts`,
  and mechanical import/type updates in any other `src/` file that references a removed symbol.
  Anything else in `src/` (new export, behaviour change, new option) escalates. Record it as
  friction: symptom, game call site, why no supported API expresses it, proposed contract change
  (owning doc and section), alternatives. No game-side workaround, cast, private import or shim.
- **An acceptance criterion cannot be met**, or a parity/determinism oracle fails after two fix attempts.
- **Hardware or browser evidence contradicts an assumption** (adapter change, WebGPU unavailable,
  hidden-window samples, iframe gesture not honoured).
- **Scope creep beyond the plan**, including NGNE-12/13/14 work.
- The interleaved A/B shows the migrated median above the pre-build median by more than 20% inside
  the attributable window (stop-and-report trigger, not an acceptance threshold; see
  [Chaos-only harness](#chaos-only-harness)).
- `git diff 12b727e -- src/renderer.ts` shows any change inside `Sprite`, `Frame` or `packAffine`.

Non-blocking friction (verbose but supported authoring) is logged in the NGNE-27 verification
section and, for the platformer, `examples/platformer/FINDINGS.md`, then work continues.

## File ownership

| Path                                                                                                                                                                                                                                            | Phase | Change                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| `docs/verification.md`                                                                                                                                                                                                                          | 0–6   | New top `## NGNE-27` section appended per phase; prior sections untouched                                              |
| `tests/ecs-soa.test.ts`                                                                                                                                                                                                                         | 1, 4  | Four focused tests (1); split the mixed-mode test, deleting only legacy assertions (4)                                 |
| `tests/benchmark.ts`                                                                                                                                                                                                                            | 1, 4  | Paired epoch arm (1); remove legacy collision-grid arm (4)                                                             |
| `docs/contracts/NGNE.md`                                                                                                                                                                                                                        | 1–4   | Inventory (1); game rows (2, 3); bridge/option/`Renderer` removal and migration (4)                                    |
| `examples/platformer/{game,main}.ts`, `README.md`, `FINDINGS.md`                                                                                                                                                                                | 2     | Schema components, WebGPU host, diagnostic pattern, docs                                                               |
| `tests/platformer.test.ts`                                                                                                                                                                                                                      | 2     | `player()` helper reads schema field records; parity fixture                                                           |
| `demo/{game,main}.ts`                                                                                                                                                                                                                           | 3     | Schema components, view/row collision grid, `ImageAsset` atlas, WebGPU host, diagnostic pattern                        |
| `tests/game.test.ts`, `tests/ownership.test.ts`, `tests/image-readiness.test.ts`                                                                                                                                                                | 3     | Follow migrated Starfall; decoded-only setup assets and atlas lifetime                                                 |
| New `tests/browser-game-checks.ts`, wired from `tests/browser-validation.ts`                                                                                                                                                                    | 2–4   | Unsupported-message fixtures (2, 3), Starfall atlas lifetime (3); WebGL checks deleted elsewhere (4)                   |
| `src/renderer.ts`, `src/browser.ts`, `src/ecs.ts`, `src/index.ts` (+ mechanical importer updates)                                                                                                                                               | 4     | Delete `Renderer`; remove option, WebGL branches, bridge; explicit exports                                             |
| `tests/engine.test.ts`, `tests/simulation.contract.test.ts`, `tests/api-misuse.ts`, `tests/browser-{validation,interpolation,input,lifecycle}-checks.ts`, `tests/browser-renderer-benchmark.ts`, `tests/browser-baseline.ts`, `validation.html` | 4     | Schema components; WebGPU-only paths; adapter info via WebGPU                                                          |
| `index.html`, `tests/browser-webgpu-checks.ts`, and every other file matched by the phase 4 WebGL scan before editing                                                                                                                           | 4     | Stale WebGL text (`index.html:166` `INSTANCED WEBGL 2`, `browser-webgpu-checks.ts:7` comment) updated; text-only edits |
| `examples/hello/main.ts`, `README.md`, `docs/assets/ngne.svg`, `docs/{guide,decisions,roadmap,architecture}.md`                                                                                                                                 | 4, 5  | Drop `renderer: "webgpu"`; `WEBGL 2` artwork label becomes `WEBGPU`; migrated usage; status                            |

Raw diagnostics (bench text, browser JSON, screenshots, revision exports, parity traces, manifests)
live outside the checkout in `C:/Users/jfabi/AppData/Local/Temp/ngne-27-diagnostics/`.

## Measurement and oracle methods

### Provenance manifest

Every raw result from phase 1 onward gets a sidecar `<result>.manifest.txt`: `git rev-parse HEAD`,
`git status --porcelain`, SHA256 of `git diff HEAD` output, and SHA256 of each untracked file listed.
Harness-printed revisions alone cannot distinguish baseline from migrated runs.

### Chaos-only harness

A temporary script `chaos-only.ts`, kept in the diagnostics directory, copied unchanged into each
tree under test and run with `npx tsx chaos-only.ts` in a **fresh process per run**. It runs only
the Chaos section of the NGNE-26 harness: `arena({ stress: true })`, seed `bench`, 900 ticks of
`tick` + `render` + `sort` at alpha 0.5, samples ticks 101–899, prints min/p50/p90/p95/p99/max/mean,
peak sprites and entity slots. No preceding ECS workload. Imports resolve relative to the tree
(`./demo/game.ts`, `./src/index.ts` or the revision's equivalent); the script text is identical across trees.

- **Attribution (phase 0):** exports of `a906f3a` (A) and `9c00f02` (B) via `git archive`, `npm ci`
  each; order A B A B A B, machine idle. Verdict **attributable to NGNE-20** if every B p50 exceeds
  every A p50 and the B−A median gap exceeds the larger of the two same-revision p50 ranges;
  otherwise **unexplained within run noise**. Label either way: "unchanged Starfall Chaos workload on
  the legacy object bridge".
- **Migration A/B (phases 3, 4, 5):** export of `12b727e` (P, kept from phase 0) vs the working tree
  (M), order P M P M P M. Pre- and post-migration gameplay may diverge after the Chaos order window
  `W`, so the script reports two windows separately:
    - **Attributable window** ticks 101…`W` (identical simulation): medians, ranges and M/P ratio. The
      20% stop trigger applies here, only if the window has at least 100 samples.
    - **Whole run** ticks 101–899: medians, ranges, peak sprites and slots, labelled non-attributable
      whole-game evidence because populations may differ. No trigger.
    - If Chaos `W` < 200, run the same A/B on the Starfall normal scripted run (window 101…`W`, same
      100-sample minimum). If neither window qualifies, report "no attributable Chaos/normal CPU
      comparison window" as an open decision for the user instead of applying the trigger.

### Paired epoch traversal arm

New `tests/benchmark.ts` section on the existing 20,000-entity typed pass. Per sample: an untimed
`commit()` with no membership change (timed separately and reported), then time traversal 1
(first in the new epoch, includes descriptor reconstruction at `src/ecs.ts:328`) and traversal 2
(identical, same epoch). Report distributions of traversal 1, traversal 2, the paired per-sample
delta (1−2) and commit time. Confirm from `src/ecs.ts:653` that a no-op commit advances the epoch;
if it does not, stop and report.

### Parity oracles

Headless probe scripts (diagnostics directory, public API plus demo/example modules) sample after
every committed tick. Phase 0 captures on the pre-build tree; phases 2/3 rerun the same probe on the
migrated tree. The probe computes, from `Game.enumerate()` plus `game.state`:

- **Canonical state hash:** SHA256 of a JSON document with durable `game.state`, scene stack
  IDs/keys/seeds, every authoritative resource value (resources the contract inventory classifies
  as derived caches are excluded: Starfall `collision-grid`, whose representation intentionally
  changes), every named RNG `snapshot()`, camera fields, and, per
  component composition, the **sorted multiset** of live entity component-value tuples (field names
  sorted, entity handles and row positions excluded). Legacy object values and schema field records
  are normalised to the same `{ component: { field: value } }` tuple shape; booleans stay booleans.
- **Order window:** the last tick `W` such that, at every committed tick `≤ W`, every
  **order-sensitive** archetype holds at most 512 live rows. Within the window, legacy dense order
  and schema chunk order are identical by construction (contract "Storage, lifetime, and order");
  after it, chunk-local swap removal may legitimately reorder traversal.
    - Order-sensitive: any archetype whose traversal order can change simulation values: RNG draws,
      first-match collision (`demo/game.ts:351-438`), spawns or cross-entity reads inside the loop.
      Starfall `(position, body, visual)`; every platformer archetype.
    - Order-insensitive: Starfall `(position, particle)`. Its update (`demo/game.ts:488-499`) is
      per-row independent, draws no RNG and reads no other entity, so its sorted multiset is unchanged
      by reordering; its 6,000 Chaos rows do not end the window. The executor re-verifies this at the
      migrated call site; if the port adds any order dependence there, stop.
- **Derived cache proof:** in phase 3 the stop report cites the lines where `collision-grid` is
  cleared and rebuilt before its first read in every continuing update (the phase 5 inspector
  verifies the citation), and exact hash parity inside `W` shows collision outcomes are unchanged
  while the cache itself is excluded from the hash.

| Run                                                                                                                    | Terminal condition                                         | Rule                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platformer reference walkthrough                                                                                       | Walkthrough end (1,448 ticks)                              | `W` must cover the whole run (checked in phase 0; if not, stop). Hash equal at every tick; 0 deaths.                                                                                                                                                                                            |
| Starfall normal (`arena()` seed `bench`, scripted input: hold right 120 ticks, left 120, Space at tick 300, then none) | Run phase `dead` or `won`, or tick 11,000, whichever first | Hash equal at every tick `≤ W` (record `W`; if `W < 120`, stop and report). After `W`: migrated run must be deterministic (two runs, identical hashes every tick) and reach a terminal condition with no exception. Pre/post terminal outcome, tick and score are recorded, not required equal. |
| Starfall Chaos (`arena({ stress: true })` seed `bench`)                                                                | Tick 900                                                   | Same as normal, except no minimum `W` (240 initial enemies plus bullets may cross 512 early); record `W`.                                                                                                                                                                                       |

A hash mismatch inside the window stops the phase. Both games also require identical hashes between
two consecutive migrated runs over the full run.

## Phases

A phase that fails its gate is fixed within the phase (at most two attempts) or stopped and reported.

### Standard gate

```powershell
npm.cmd test              # all pass; report count
npm.cmd run typecheck     # exit 0
npm.cmd run build         # exit 0; library, API fixture, three Vite entries
npm.cmd run format:check  # exit 0
git diff --check          # no output
```

Browser validation, where listed: `npm.cmd run dev -- --port 5173`, open
`http://127.0.0.1:5173/validation.html` in the in-app Chromium, start with a real click, require
`ALL CHECKS PASSED`, 0 FAIL, 0 SKIP and no console errors; report the PASS count and any change from
the previous phase with its reason.

Import scan (A1), PowerShell: `git grep --untracked -n -E 'from "(\.\./)+src/' -- demo examples`
returns nothing (exit code 1 is the pass condition for every "returns nothing" scan).

### Stop report (every phase)

1. Changed files.
2. Each gate command with exact result/count.
3. Evidence recorded and where (with manifests).
4. `MANUAL (user)` checks pending, with steps and pass criteria.
5. Friction found.
6. Open decisions.

Then wait for explicit user validation.

### Phase 0 — Baseline and provenance

- **Goal:** capture everything that cannot be reproduced after WebGL and the bridge are gone. No
  source, test or doc edits except the new verification section.
- **Entry:** approved plan hash matches; HEAD is `12b727e7f095a3ddd763724190a9d12ace6d2d76` and the
  only untracked files are `plans/NGNE-27-*` (otherwise report and stop).
- **Work:**
    1. Record HEAD, `git status`, plan SHA256, Node/npm, OS, CPU, in-app Chromium and headful Chrome
       versions, WebGPU adapter info from the validation page, secure context, DPR.
    2. Standard gate and full `validation.html`; record counts as the pre-build baseline.
    3. `npm.cmd run bench` x2 at HEAD (2 outputs).
    4. Export `a906f3a`, `9c00f02` and `12b727e` into the diagnostics directory. Chaos-only attribution
       A/B, 6 fresh-process runs (6 outputs). Keep the `12b727e` export for later phases.
    5. Parity captures on the `12b727e` export: platformer walkthrough, Starfall normal and Chaos.
    6. Sustained browser baselines on the production build (`npm.cmd run build`, `npm.cmd run preview`),
       headful Chrome via `node --import tsx tests/browser-baseline.ts`: Starfall Chaos Lab x2,
       platformer idle (`?baseline`) x2, 10 s warmup, 60 s sample, fresh launch each (4 JSONs).
    7. Reference screenshots on WebGL: Starfall attract, flight, Chaos Lab, result screen; platformer
       level 1, level 2, pause, completion.
    8. Add `## NGNE-27 — <date>` to `docs/verification.md`: pre-migration baseline, attribution verdict, method.
- **Automated gate:** standard gate identical to step 2; exactly 8 bench outputs (2 + 6); 3 parity
  captures; 4 browser JSONs each with 0 visibility changes; `git status --porcelain` shows only
  `docs/verification.md` and `plans/NGNE-27-*`.
- **MANUAL (user):**
    - Keep the headful Chrome window visible and the machine idle during the 4 sustained runs (~6 min)
      and the 8 bench runs. Pass: harness reports 0 visibility changes and the user confirms nothing else ran.
    - Play each WebGL game ~1 minute with sound on (Starfall: Start Flight, then Chaos Lab; platformer:
      level 1 including one death). Pass: user writes a short reference note (visual look, music
      audible and looping, cue timing) for later comparison.
- **Docs:** `docs/verification.md`.
- **Stop:** standard report including the attribution verdict.

### Phase 1 — NGNE-20 follow-ups

- **Goal:** A5, A7 and the A6 descriptor-cost measurement, before any game changes.
- **Entry:** phase 0 validated by the user.
- **Work:**
    1. `tests/ecs-soa.test.ts`, public/intentional boundaries only:
        - same-query nesting: `q.eachChunk` inside `q.eachChunk` over 600 rows (two chunks) visits the
          full chunk cross product in creation/chunk/row order;
        - commit attempted inside the **inner** callback of a same-query nested pair throws, and after
          both callbacks return a commit succeeds;
        - `entityAt(row)` returns the identical (`===`) handle `spawn()` returned, for rows in both chunks,
          and after a committed swap removal returns the moved entity's same canonical handle;
        - `Game.enumerate()` for an `entityRef` field holding null, a live target and a stale target
          (despawned and committed): `deepStrictEqual` on the whole field record (`null`,
          `{ index, generation }`) and on the target slot records that show liveness.
    2. `tests/benchmark.ts`: [paired epoch traversal arm](#paired-epoch-traversal-arm). Existing sections
       keep their output shape.
    3. Contract ownership inventory rows "ECS values and identity" and "Allocator and iteration history":
       schema chunk creation and lowest-chunk reuse order, chunk-relative row plus chunk index
       locations, field-record inspection (`fields: [{ name, kind, value }]`), immutable schema
       definitions and frozen field descriptors, per-epoch descriptor borrowing. Legacy rows stay until phase 4.
- **Automated gate:** standard gate (test count = phase 0 + 4); `npm.cmd run bench` x2 with manifests;
  existing sections' medians within the phase 0 ranges or the difference reported.
- **MANUAL (user):** read the inventory rows. Pass: user confirms the five A7 facts are named and accurate.
- **Docs:** `docs/contracts/NGNE.md`, `docs/verification.md`.
- **Stop:** standard report.

### Phase 2 — Platformer port, NGNE-15 replay

- **Goal:** platformer on schema ECS and WebGPU with identical simulation.
- **Entry:** phase 1 validated.
- **Work:**
    1. Components to schema per the decision table; `.each` to `eachChunk`; player aliases to sparse
       `read`/`write` or per-update views. No `src/` edits.
    2. `tests/platformer.test.ts`: `player()` helper reads schema field records; add a parity test that
       embeds the phase 0 canonical hashes for every 60th tick (25 values) and recomputes them with the
       same normalisation over schema field records.
    3. After headless parity passes: `renderer: "webgpu"` in `examples/platformer/main.ts`, hello's
       diagnostic pattern (append `Error` only, flatten `AggregateError`/`cause`, ignore overload
       notices), actionable WebGPU capability message on startup failure.
    4. `tests/browser-game-checks.ts` platformer unsupported fixture, using the NGNE-21 hello technique
       (`tests/browser-image-checks.ts:200-250`): fetch `/examples/platformer/index.html`, build `srcdoc`
       with a module script that replaces `navigator.gpu` (adapter request resolves `null`) **before**
       importing `/examples/platformer/main.ts`. The executor clicks the iframe's Start button with
       trusted browser input. Assert the exact capability message is visible, still present after
       500 ms, and the start button remains disabled or shows the error presentation.
- **Automated gate:** standard gate; parity oracle exact; walkthrough 1,448 ticks, 0 deaths; import scan
  empty; validation page all pass including the new fixture.
- **Browser replay (executor, driven in the in-app browser):** NGNE-15 table (start, move/jump/camera,
  fall death and remount, level 1 and 2 completion, completion overlay, restart, pause by P/Escape/button,
  resume, frozen frame while paused), NGNE-9 game flow (P pause, button resume, canvas focus), NGNE-10
  step 5 (start, three pause/resume, no error UI or console error). Screenshots against phase 0.
- **MANUAL (user):**
    - Physical keyboard, both levels: at least one fall death with remount at the last committed
      checkpoint, one checkpoint, both exits, completion overlay, Play again. Pass: completes; visuals
      match phase 0 screenshots.
    - Pause/resume three times each via P, Escape and the button; switch tabs for 3 s during play.
      Pass: paused frame static and dimmed, no pose jump on resume, tab-hide pauses.
    - Sound on: music loops after start and after a death remount; jump/death/checkpoint cues play
      once each. Pass: matches the phase 0 reference note.
    - Gamepad only if available: move, jump, Start pauses. Otherwise report "untested".
- **Docs:** `examples/platformer/README.md` (WebGPU requirement), `FINDINGS.md`, `docs/verification.md`.
- **Stop:** standard report.

### Phase 3 — Starfall port, NGNE-9/10 replay

- **Goal:** Starfall and Chaos Lab on schema ECS and WebGPU, atlas via preparation-time readiness.
- **Entry:** phase 2 validated, including its `MANUAL (user)` checks.
- **Work:**
    1. Four components to schema per the decision table; `.each`/`get` to `eachChunk` and sparse access;
       collision grid of entity + row + chunk component views, cleared and rebuilt each update before
       probing; hp/active writes through views or sparse `write`. `Frame.sprite`/`rect` calls unchanged.
    2. Atlas `ImageAsset`; delete the manual texture upload; `renderer: "webgpu"`; hello diagnostic
       pattern replacing overwrite-only `#error`; boot failure names WebGPU instead of WebGL 2;
       `pagehide` dispose like hello.
    3. Tests: `tests/game.test.ts` and `tests/ownership.test.ts` follow the migration. Decoded-only
       boundary: a headless test asserts arena setup receives the atlas value unchanged from its loader
       (a fake decoded object identity) and that no Starfall component field or resource can hold it
       (schema fields are numeric; resource names audited in the contract row).
    4. Browser atlas lifetime in `tests/browser-game-checks.ts`: a WebGPU `BrowserGame` with Starfall's
       `arena`, a counting atlas `ImageAsset` wrapper, then three `set` replacements through fresh
       `prepare` calls. Assert `load` once, `dispose` zero times while running, the atlas sprite pixels
       render after each replacement (production encoder readback as in NGNE-21), and `dispose` exactly
       once after `app.dispose()`. Renderer-source lifetime is mandatory: before preparing, the check
       wraps the public `app.game.assets.acquire` method on that instance (test-local wrapper, no new
       export) to count atlas leases acquired and released, separating scene-consumer leases from the
       host's additional source lease (`src/browser.ts:86-100`). Assert after each replacement that
       exactly one scene lease and one renderer source lease are live, and after `app.dispose()` that
       all atlas leases are released. If the wrapper cannot observe the host lease, stop and report.
    5. Starfall unsupported fixture (same technique as phase 2; Starfall's boot prepares images, so no
       click is needed). Assert the exact message persists after 500 ms.
    6. Parity oracles (normal and Chaos) exact; determinism exact; Chaos-only migration A/B.
    7. Contract inventory Starfall rows: component fields, view/row collision-grid cache, borrowed-epoch rule.
- **Automated gate:** standard gate; parity and determinism exact; A/B within the stop trigger;
  `npm.cmd run bench` x2 with manifests; import scan empty; validation page all pass.
- **Browser replay (executor):** NGNE-10 step 4 (Sound off→on, Start Flight, pause/resume, Chaos Lab x3,
  `CHAOS LAB / INVULNERABLE`, no error UI or console warnings); NGNE-9 game flow (`FLIGHT PAUSED` then
  `FLIGHT IN PROGRESS`); one normal flight left without input until the result overlay (`SIGNAL LOST.` or `SKY SECURED.`), then verify HUD
  best/last score and `game.state.runs` incremented, choose **Fly again** and confirm a new flight
  starts. Screenshots against phase 0.
- **MANUAL (user):**
    - Physical keyboard and mouse: WASD/arrows move, hold mouse aims, Space nova, P/Escape pause and
      button resume, M toggles sound, Enter starts from attract. Pass: all respond; canvas keeps focus.
    - One full normal flight to a result (survive 3 minutes or die), then **Fly again**. Pass: result
      overlay copy and score correct, best score retained, new flight starts.
    - Visual: ships, bullets, particles, boss HP bar, flash and backdrop match phase 0 screenshots
      (atlas cells, colours and alpha correct). Pass: user confirms.
    - Audio: sound on, music loops, cues on shots/kills/nova, pause ducks and resume restores, Chaos
      Lab three times keeps a single music loop. Pass: audible, no stacked loops.
    - Touch buttons and gamepad only if devices are available; otherwise report "untested".
- **Docs:** `docs/contracts/NGNE.md`, `docs/verification.md`.
- **Stop:** standard report with A/B and parity results.

### Phase 4 — Remove WebGL and the bridge

- **Goal:** A2 (production build half). Single WebGPU path, schema-only ECS, clear unsupported message.
- **Entry:** phase 3 validated; `git grep --untracked -n -E '\.each\(|world\.get\(|app\.renderer' -- demo examples/platformer`
  returns nothing.
- **Work:**
    1. `src/renderer.ts`: delete `Renderer` and its WebGL helpers; `Sprite`, `Frame`, `packAffine`
       unchanged. `src/index.ts`: replace `export *` from renderer with explicit `Frame` and `Sprite`;
       remove `Component`, `ComponentValue`, `Query` type exports.
    2. `src/browser.ts`: remove the `renderer` option and every WebGL branch (union type, `new Renderer`,
       WebGL rollback/stop/resume/frame-failure teardown); `BrowserGame.renderer` becomes `WebGPURenderer`.
    3. `src/ecs.ts`: remove factory overload, object columns, `get`, `Query.each`, legacy
       archetype/query runtime, mixed-mode checks, legacy enumeration; empty `spawn()` becomes a
       schema-mode empty archetype; zero-argument `query()` stays.
    4. Tests: `engine.test.ts` and `simulation.contract.test.ts` use schema components, preserving each
       asserted behaviour (list any assertion that cannot be preserved in the stop report). Split the
       `ecs-soa.test.ts:427` test: delete mixed-mode/legacy assertions, keep opaque `WorldAccess`,
       duplicate query rejection, encapsulation, borrow expiry and disposed-world checks.
       `api-misuse.ts` adds `@ts-expect-error` for the factory overload, `get`, `each` and the `renderer`
       option. Delete WebGL and context-loss browser checks; interpolation checks WebGPU only; remove
       renderer benchmark `webgl` mode; `browser-baseline.ts` reports WebGPU adapter info; update
       `validation.html` copy; remove the legacy collision-grid bench arm.
    5. Games and hello drop `renderer: "webgpu"`.
    6. Contract: remove bridge and temporary renderer text; migration notes for option removal, factory
       overload removal, `Renderer` removal, empty-entity inspection shape; public symbol table.
- **Automated gate:** standard gate; `npm.cmd run bench` x2; Chaos-only A/B within the trigger;
  `git diff 12b727e -- src/renderer.ts` touches no `Sprite`/`Frame`/`packAffine` line; validation
  page all pass with the removed-check count explained;
  `git grep --untracked -n -i -E 'webgl|renderer: "webgpu"' -- src demo examples tests index.html validation.html docs/guide.md docs/assets/ngne.svg README.md`
  returns nothing (run it once before editing to list every in-scope match); import scan empty.
- **Browser (executor):** `npm.cmd run build`, `npm.cmd run preview`; at `http://127.0.0.1:4173/`,
  `/examples/hello/` and `/examples/platformer/` each game starts on WebGPU with no console errors;
  unsupported fixtures pass on the dev server.
- **MANUAL (user):**
    - Production preview: play Starfall and the platformer ~1 minute each. Pass: same behaviour as phases 3 and 2.
    - Unsupported environment: close Chrome windows using the test profile, run
      `chrome.exe --user-data-dir=%TEMP%\ngne27-nogpu --disable-gpu http://127.0.0.1:4173/`, and in
      DevTools run `await navigator.gpu?.requestAdapter()`. If the result is `null` or `undefined`,
      open all three pages. Pass: each shows its actionable WebGPU message, no blank canvas or silent
      failure. If an adapter is still returned, report it; the automated fixtures remain the evidence
      and the manual item is recorded as not reproducible on this machine.
- **Docs:** `docs/contracts/NGNE.md`, `docs/guide.md` (drop option, manual `renderer!.texture` snippet,
  legacy `each` note), `README.md`, `docs/assets/ngne.svg`, `examples/hello`, `docs/decisions.md`,
  `docs/roadmap.md` (removal done, deployment pending), `docs/architecture.md` only if a statement changed.
- **Stop:** standard report.

### Phase 5 — Measurements, final docs and inspection

- **Goal:** A6 evidence, A4 closure, independent inspection.
- **Entry:** phase 4 validated.
- **Work:**
    1. Post-migration sustained browser runs, same method as phase 0 (production build, headful Chrome,
       Starfall Chaos x2, platformer idle x2). Label: whole-stack change (SoA + WebGPU + removals), not
       attributable to either alone.
    2. `npm.cmd run bench` x2 and a final Chaos-only A/B. Final table: pre-build, phase 3, phase 4, final;
       epoch arm; Chaos label "Starfall Chaos Lab, seed `bench`, 900 ticks, CPU-only tick + render +
       sort at alpha 0.5, samples 101–899, no GPU; identical `Frame` code in both arms; the runtime
       variable is Starfall on schema ECS (post) versus the legacy object bridge (pre), including
       gameplay divergence after the order window".
    3. Complete the verification record: environment, attribution verdict, descriptor-cost result,
       friction list, remaining limits (single GPU, untested devices, deployment pending, NGNE-21 limits carried).
    4. Consolidate docs; A4 review of guide and example READMEs against the final code.
    5. Fresh independent read-only inspection of the full diff against this plan and pre-build HEAD by a
       reviewer that did not build it; at most two rounds; fixes rerun affected gates.
- **Automated gate:** standard gate; validation page all pass; bench x2; Chaos-only A/B;
  `npx prettier --check plans/NGNE-27-*.md`.
- **MANUAL (user):**
    - Keep Chrome visible and the machine idle during the 4 sustained runs. Pass: 0 visibility changes.
    - Sign off the verification section and remaining limits.
- **Docs:** `docs/verification.md`, `docs/roadmap.md`, `docs/guide.md`, `docs/decisions.md`.
- **Stop:** final report: changed files, all proofs, inspection verdict, open decisions, and the
  request for the two commit/push authorizations phase 6 needs. `docs/verification.md` states
  "deployment verification pending (phase 6)"; roadmap says removal done, deployment pending.

### Phase 6 — Deployment closeout

- **Goal:** A2 (deployed half) and ticket completion, ending on a final SHA that is inspected,
  committed and deployment-verified.
- **Entry:** phase 5 validated, and explicit user authorization for **both** commits and pushes below
  (or the user performs them). Without it NGNE-27 stays incomplete and phase 5's state is the handoff.
- **Work:**
    1. `npm.cmd run format`, review the diff, standard gate. Commit C1 `[NGNE-27] <message>` containing
       all phase 0–5 changes; push to `main` only as authorized.
    2. Confirm the "Verify and deploy" run for C1 (`gh run list --workflow ci.yml --commit <C1>`,
       `gh run view <id>`): `verify` and `deploy` green. Record SHA and run URL.
    3. `MANUAL (user)` live check below against C1.
    4. Docs-only closeout: `docs/verification.md` deployment result (C1 SHA, run URL, user check);
       `docs/roadmap.md` marks NGNE-27 done. Run `npm.cmd run format:check`, `git diff --check` and a
       local link/anchor check of the changed Markdown.
    5. Fresh read-only inspection of the docs-only delta by the phase 5 inspector session (or a new
       one): evidence matches C1 and the user's confirmation.
    6. Commit C2 `[NGNE-27] <message>` and push as authorized. Verify
       `git diff C1 C2 --stat` lists only `docs/verification.md` and `docs/roadmap.md`, and the C2 CI run
       is green including `deploy`.
- **Automated gate:** C1 and C2 workflow runs green; C1→C2 diff docs-only; format and diff checks pass.
- **MANUAL (user):** after C1 deploys, open `https://that-webdev-dude.github.io/ngne/`,
  `/examples/hello/` and `/examples/platformer/` in Chrome with a hard reload. Pass: all three start
  and render (Starfall HUD shows `RUNNING`, platformer level 1 visible, hello sprite moving), no
  WebGL 2 text, no console errors. After C2 deploys, reload Starfall once. Pass: still runs.
- **Docs:** `docs/verification.md`, `docs/roadmap.md`.
- **Stop:** completion report with C1/C2 SHAs, run URLs and the final state. Jira remains untouched
  unless the user asks.

## Verification contract

- Windows uses `npm.cmd`. Record fresh counts; never reuse historical counts as the baseline.
- Headless oracles: [parity oracles](#parity-oracles), walkthrough, determinism; existing
  interpolation, lifecycle, state, ownership, image-readiness and audio suites.
- Browser: extended `validation.html` is the only browser harness; preserve the final
  `ALL CHECKS PASSED` marker, aggregate failures, list skips. Required checks skipped for lack of
  WebGPU are failures.
- Performance: local evidence for this workload and machine only. Accepted sustained samples stay
  visible throughout; rejected samples keep their raw files with a `.rejected` suffix. Every raw result has a manifest.
- `MANUAL (user)` items are never simulated or marked passed without the user's confirmation.
- Before any authorized commit: `npm.cmd run format`, review the diff, one-line `[NGNE-27] <message>`.

## Documentation

| Owner                                                                        | Update                                                                                                          | Phase |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----- |
| `docs/contracts/NGNE.md`                                                     | Ownership inventory; bridge/option/`Renderer` removal; empty-entity inspection; public symbols; migration notes | 1–4   |
| `docs/guide.md`, `README.md`, example READMEs, hello, `docs/assets/ngne.svg` | Migrated authoring usage, WebGPU-only requirement, atlas via `ImageAsset`                                       | 2–5   |
| `docs/verification.md`                                                       | Baselines, Chaos attribution, per-epoch cost, browser/GPU context, results, friction, limits, deployment        | 0–6   |
| `docs/roadmap.md`                                                            | Migration and bridge-removal status; done only after phase 6                                                    | 4–6   |
| `docs/decisions.md`                                                          | WebGL/bridge status lines; `f64` port decision and parity rationale                                             | 4, 5  |
| `examples/platformer/FINDINGS.md`                                            | Platformer migration friction                                                                                   | 2     |

## Handoff

Session 2 follows [the handoff](NGNE-27-handoff.md): pre-build HEAD, this plan's approved SHA256,
one phase at a time with user validation between phases, and the escalation triggers above.
