# Plan Review Log: NGNE-15 — two-level platformer

Started 2026-09-09 (user local time). MAX_ROUNDS=5. PLAN_FILE=plans/NGNE-15-platformer.md. Reviewer: Codex CLI 0.148.0, model gpt-6-astra (from ~/.codex/config.toml), read-only sandbox every round.

## Round 1 — Codex

_Note: the first two attempts failed before review with `The 'gpt-6-astra' model requires a newer version of Codex` on CLI 0.148.0; user approved upgrading to 0.153.4 and the round was rerun. Thread 01a08775-6331-7b61-a925-d926bdfa9cb7._

The plan has material lifecycle and validation gaps. No files were modified.

1. **Progression can commit without a successful replacement.** [Steps 9–10](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:52) leave exit retry behavior unspecified. An unavailable candidate can cause repeated `exit` dispatches; a failed mount preserves the old scene after progression has already advanced ([commit implementation](/C:/Users/jfabi/Documents/Projects/tests/ngne/src/scene.ts:526)). Death also starts a timer but immediately polls for replacement, potentially bypassing the delay.  
   **Fix:** Define explicit pending-transition phases, dispatch each durable command once, gate respawn on timer expiry, and specify visible recovery from preparation/mount failure.

2. **DOM and keyboard resume can remove the gameplay scene.** [Step 11](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:54) permits both paths: a queued DOM `pop()` plus an overlay’s keyboard `pop()` produces two FIFO pops at the same commit. Pause and exit requests can likewise compete because pushing an overlay does not stop the current schedule.  
   **Fix:** Route host controls into intents consumed by one scene system, coalesce requests, and define one transition winner per tick.

3. **Speculative candidate keys and ownership are underspecified.** [Steps 9–10 and the readiness risk](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:100) prepare candidates before the corresponding state change; “reprepare on consumption” can still observe pre-commit state. Death also makes an already-prepared next-level attempt key obsolete.  
   **Fix:** Compute explicit target level/attempt keys, replenish from confirmed committed mounts, and release obsolete candidates and late results belonging to an earlier mount.

4. **The proposed leak check cannot establish absence of leaks.** [Step 20](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:74) checks mounted scenes and host references, but losing a host reference leaves an unused candidate retained in the Game’s private map. Unmount does not release unrelated speculative candidates.  
   **Fix:** Give every preparation an owner and terminal consume/release path, then test those paths across death, exit, restart, cancellation, and disposal.

5. **Input-only determinism does not cover this host-driven flow.** [Step 18](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:67) omits candidate availability and DOM activation ticks, which the [contract explicitly identifies as additional repeatability inputs](/C:/Users/jfabi/Documents/Projects/tests/ngne/docs/contracts/NGNE.md:64). A synchronous 600-tick loop can also prevent promise continuations from delivering replacement candidates.  
   **Fix:** Use a deterministic harness with fixed seed/display and scheduled candidate delivery/host intents, comparing runs through death, both exits, pause, and restart.

6. **The pause test asserts the wrong engine behavior.** [Step 18](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:69) expects `previous == current` after uncovering; NGNE preserves both values and renders at alpha 1 until the next update ([contract](/C:/Users/jfabi/Documents/Projects/tests/ngne/docs/contracts/NGNE.md:219)).  
   **Fix:** Assert unchanged stored poses, current-pose rendering immediately after pop, and normal interpolation after the next gameplay update.

7. **Checkpoint remount can initially render the wrong part of the level.** [Step 5](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:37) relies on the engine’s camera cut, but that only copies the camera’s existing coordinates; it does not position the camera around the rebuilt player. A distant checkpoint can spawn offscreen.  
   **Fix:** Initialize the clamped camera position from the checkpoint spawn during setup and test the first rendered frame before any tick.

8. **Checkpoint and terminal-state indexing are ambiguous.** [The schema](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:44) resets checkpoint to `0` while separately storing `start` and `checkpoints[]`; it never says whether zero means start or the first checkpoint, or how level index `2` and restart reset deaths/completion.  
   **Fix:** Define a start sentinel or explicit checkpoint IDs, valid level bounds, and complete initial/restart values; test death before any checkpoint and restart after finishing level two.

9. **Required collision behavior lacks a complete representation and boundary policy.** [LevelData](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:32) has only an unspecified `solids` grid for solid and one-way tiles; level-one gaps have no defined below-world death rule. The parser also lacks authored-data validation.  
   **Fix:** Define tile-kind encoding, downward-crossing rules for one-way platforms, out-of-bounds collision/death behavior, and validation for rectangular rows, symbols, and safe spawn markers.

10. **The tests leave substantial controller behavior unchecked.** [Phase 4](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:65) does not cover coyote/buffer expiry, ceiling impacts, landing from above on one-way platforms, patrol edge turns, or releasing jump while paused—the release edge can be consumed while gameplay is suspended.  
    **Fix:** Add focused fixture tests for those boundaries, including held-input reconciliation on resume and checkpoint-plus-fatal-contact precedence.

11. **The plan misstates repository rules and preclassifies unsupported findings.** [Step 3](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:33) invents an example exemption from “Do not export helpers solely for tests”; [step 25](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:81) assigns exact camera semantics solely to usage documentation. The proposed “cannot know validity after stop” finding is also false: unused candidates are explicitly invalidated by stop.  
    **Fix:** Export collision functions for their gameplay consumer, put exact camera semantics in the contract with guide examples linking there, and distinguish observed candidate bookkeeping from nonexistent validity uncertainty.

VERDICT: REVISE

### Claude's response

Accepted all 11 findings; none rejected. Changes made to the plan:

1. **Transition phases** — added an explicit phase machine (`playing → exiting|dying → transitioning`), each durable command dispatched exactly once in the same tick as the stack command, respawn gated on death-timer expiry, and mount-failure recovery via the host's `diagnostic` callback (error panel + reload, Starfall pattern).
2. **Single transition authority** — the host never issues stack commands; DOM buttons and `visibilitychange` write host _intent flags_ handed to scenes through options, and one system per scene consumes them with a fixed priority (death > exit > pause). Chose intent flags over Codex's "route into one system" wording because Starfall already injects host callbacks this way; synthesising key edges through `Input.set` was considered and rejected as harder to test.
3. **Candidate ownership** — candidates are prepared only after a mount is confirmed (the mounted scene reports `{level, attempt}` through `onView`), keyed from that scene's committed facts, tracked in a host-side registry with purpose + owning instance, and released when the owning instance is replaced or a late result arrives for a stale owner. This bookkeeping moves into a DOM-free `transitions.ts` so tests can exercise it.
4. **Leak evidence** — tests cover every candidate path (respawn, next, pause, complete, restart, stale-owner release, disposal) through the registry; browser check now says what it can and cannot show.
5. **Deterministic harness** — an async harness advances ticks with a microtask drain and a scripted schedule of inputs and host intents by tick; comparisons run through death, both exits, pause and restart. The synchronous 600-tick loop stays only for the pure-input determinism case.
6. **Pause test** corrected to the contract: stored poses unchanged, alpha-1 rendering on the pop frame, ordinary interpolation after the next update.
7. **Camera on mount** — setup positions the clamped camera around the spawn point before the engine's cut; a test asserts the first frame before any tick.
8. **Schema** — `checkpoint 0` = level start, `k>0` = k-th marker; `level 2` = complete; `restart` resets to a fresh run and increments `runs`; deaths before any checkpoint and restart after level two are tested.
9. **Tile representation** — explicit tile-kind encoding, one-way downward-crossing rule, side bounds as walls, fall-out death line, parser validation of rows/symbols/markers.
10. **Controller tests** — coyote/buffer expiry, ceiling contact, one-way landing, patrol edge turn, jump-cut through pause (jump cut reads `held`, not the `released` edge, so a release consumed while suspended cannot be lost).
11. **Rules** — collision exports justified by their gameplay consumer; camera origin semantics go to `docs/contracts/NGNE.md` with a guide example linking there; dropped the false "candidate validity after stop" finding (contract already states stop invalidates unused candidates).

## Round 2 — Codex

Material gaps remain, mainly in the revised candidate lifecycle. No files were modified.

1. **Completion does not trigger the specified candidate cleanup.** [Step 9](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:62) releases old records only when a differently-keyed **level** reports; replacing level two with the completion overlay leaves its unused respawn/pause candidates retained.  
   **Fix:** Reconcile candidate ownership on every committed replacement, including completion, and test cleanup before restart.

2. **The owner key identifies an authored attempt, not a unique mounted instance.** [Step 9](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:62) reuses `level-0-attempt-0` after restart, so key equality alone cannot reject an old preparation arriving during a later run with that same key.  
   **Fix:** Use the public mounted scene ID or a host generation token for lifetime checks, retaining authored keys solely for deterministic seeds.

3. **The headless harness omits the operation that starts preparation.** [Step 18](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:81) ticks and drains microtasks, but step 9 initiates preparation through first-render `onView`; without rendering, that work never starts. Draining between every tick also misses browser catch-up ticks that run without intervening renders or promise continuations.  
   **Fix:** Specify render/host-service boundaries in the harness and include a multi-tick frame plus explicitly delayed candidate delivery.

4. **Restart still lacks an explicit unavailable-candidate and failure path.** [Step 13](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:72) calls `set(options.restart())` on an input edge, although preparation can still be pending; unlike the level scene, the completion overlay has no stated waiting or terminal phase.  
   **Fix:** Latch restart intent, wait for a handle, dispatch/set once, and enter a terminal phase that prevents repeated restart dispatch after mount failure.

5. **Pause requests can disappear while preparation is pending.** [Step 10](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:67) pushes only “if available”; a keyboard edge during candidate replenishment is consumed without pausing, and host-flag retention is unspecified.  
   **Fix:** Retain one pending pause request until fulfilled, explicitly clear it when death/exit wins, and test unavailable-candidate and tab-hide cases.

6. **Checkpoint publication remains outside the defined transition precedence.** The contact system runs before the transition authority, while [step 10](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:63) only orders fatal, exit, and pause outcomes. A checkpoint overlapping fatal contact may still commit; player physics/checkpoint handling during `dying` is also unspecified despite continued world simulation.  
   **Fix:** Have contacts produce facts only, define checkpoint-versus-death precedence in the authority system, and disable player progression outside `playing`; test both cases.

7. **Two proposed documentation claims are false.** [Step 25](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:102) says `cut()` copies coordinates “only,” but [`cut(x, y)` assigns both current and previous coordinates](/C:/Users/jfabi/Documents/Projects/tests/ngne/src/primitives.ts:55). [Step 16](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:77) claims no engine ownership of speculative candidates, although Game owns their handles, status, leases, and stop/dispose cleanup.  
   **Fix:** Distinguish no-argument `cut()` from `cut(x, y)`, and describe the missing capability as associating speculative candidates with the lifetime of their requesting scene.

VERDICT: REVISE

### Claude's response

Accepted all 7 findings; none rejected.

1. Reconciliation now runs on **every** committed replacement, detected by a change of `game.scenes[0].id`, so the completion overlay releases the last level's respawn/next/pause records; tested before restart.
2. Owner identity is the **public instance id** from `game.scenes`, not the authored key. This also removed the `onView` identity report: the host reads `game.state` and `game.scenes` directly. Authored keys remain only for deterministic seeds.
3. The harness now models a **host frame** (N synchronous ticks → `reconcile` → render → one microtask drain) and can gate candidate delivery; a multi-tick-frame case is added.
4. The completion overlay gets the same latch/wait/dispatch-once/terminal-phase authority as the level scene.
5. Pause requests are **latched** in `run.pauseRequested`, retried until a handle exists, cleared when death or exit wins; tab-hide and replenishment-gap cases are tested.
6. Contact systems write facts only; the authority system decides with priority fatal > exit > checkpoint > pause; player physics runs only in `playing`. Same-tick checkpoint+fatal is tested (death wins, checkpoint not committed).
7. Corrected both claims: no-argument `cut()` vs `cut(x, y)` distinguished in the engine-facts section, step 25 and the contract wording; the FINDINGS entry now says the missing capability is associating a speculative candidate with the lifetime of its requesting scene, not "no engine ownership".

## Round 3 — Codex

Three problems remain in the revised reconciliation and frame model.

1. **End-of-frame state may already be ahead of the newly mounted attempt.** [Step 9](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:64) derives candidates from `game.state`: if attempt `a` mounts and dies during subsequent catch-up ticks before reconciliation, state already contains `a+1`, so the prepared respawn incorrectly gets key `a+2`.  
   **Fix:** Derive the owner’s level/attempt from its immutable mounted key, and test mounting followed by death before the first reconciliation.

2. **Pending pause preparation does not prevent duplicate preparation.** [Step 9](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:64) prepares whenever no **ready** pause record exists; repeated reconciliation while a gated preparation remains `preparing` therefore starts additional preparations for the same owner/purpose.  
   **Fix:** Permit at most one preparing-or-ready record per owner/purpose, with an explicit bounded retry state; test repeated reconciliation while delivery is gated.

3. **The new harness ordering and delivery assertions contradict the browser host.** [Step 18](/C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-15-platformer.md:88) reconciles before rendering, but [`BrowserGame.afterFrame`](/C:/Users/jfabi/Documents/Projects/tests/ngne/src/browser.ts:110) runs afterward. Its late-candidate test also expects `set` during the frame whose final microtask drain delivers the handle, when that frame’s ticks have already finished.  
   **Fix:** Model ticks → render → `afterFrame` reconciliation → promise delivery, and assert activation on the first subsequent tick; specify delivery boundaries explicitly instead of assuming a universal one-frame difference.

VERDICT: REVISE

### Claude's response

Accepted all 3 findings; none rejected.

1. Owner level/attempt are now parsed from the mounted scene's public authored `key` (`game.scenes[0].key`), never from `game.state`; the engine-facts section records why (state can be ahead within one frame) and a "mount then die in one 5-tick frame" test asserts the respawn key is `attempt+1` of the mounted instance.
2. Registry invariant: at most one `preparing`-or-`ready` record per (owner, purpose); `failed` status with `retries ≤ 1`; a test counts `prepare` calls across repeated reconciles while delivery is gated.
3. Harness order now matches `BrowserGame`: ticks → render → reconcile (the `afterFrame` slot) → microtask drain. Activation is asserted on the first tick of the following frame; the late-candidate test names the release frame and the exact activation tick. The engine-facts section documents the browser frame order.

## Round 4 — Codex

The three outstanding findings are resolved: mount identity comes from the immutable key, pending preparations are deduplicated with bounded retries, and the harness follows browser frame ordering with explicit activation ticks.

I found no remaining material flaws that block implementation. This approves the plan; implementation correctness still depends on the specified tests and browser validation. No files were modified.

VERDICT: APPROVED

## Outcome

Converged: **APPROVED after 4 rounds** (3 REVISE, 1 APPROVED). 21 findings raised, 21 accepted, 0 rejected. Implementation not started; awaiting human gate #2.

# Build Log: NGNE-15 — Codex builds, Claude reviews

Human gate #2: user chose "Codex implements the plan, Claude reviews" (2026-09-09). Plan committed as `c6e693f`. NGNE-15 transitioned to In Progress. Codex runs with `-s workspace-write`, `approval_policy=never`, a fresh thread per build; each round covers one plan phase, then Claude reviews the diff and runs the checks before committing.

## Build round B1 — Phase 1 (Codex thread 01a0878b-5d8f-78b0-94fd-244b2c6969ff)

Codex delivered `examples/platformer/{index.html,levels.ts,collision.ts,game.ts,transitions.ts,main.ts,FINDINGS.md}`, `tests/platformer.test.ts` (12 tests) and the Vite entry. No `src/`, docs or git changes.

### Claude's review

Independently re-ran `npm run format:check`, `npm run typecheck`, `npm test` (66/66) and `npm run build` (platformer entry emitted): all pass. Read every file.

Accepted. Observations carried into B2 (none blocking):
- Scene definition id is `platformer-level` for both levels; use `platformer-level-${index}` so definition identity differs per authored level (contract: one compatible definition per ID).
- FINDINGS #5 (nonempty `Uint8Array` cannot be frozen) accepted as a documented convention; scenes copy the bytes.
- `exiting` on level 1 currently waits forever because no `next`/`complete` candidate exists yet — expected for the slice, closed by Phase 2.
- `onView` allocates a frozen copy per render; acceptable for an example and consistent with Starfall.
- Authority handles exit contact and candidate consumption in the same tick when the handle is already ready; consistent with the plan's "travel together" rule.
- Browser playthrough deliberately deferred to Phase 5; jump reach (≈102 px at full speed vs 80 px widest gap) is plausible on paper.

Committed as `[NGNE-15] Add playable platformer slice`.

## Build round B2 — Phase 2 + remaining Phase 4 tests (same Codex thread)

Codex delivered level 2, `createOverlay` (pause + completion with latched restart), host intents/HUD in `main.ts`/`index.html`, scoped synth audio, per-level definition ids, and 22 more tests (88 total). No `src/`, docs or git changes.

### Claude's review

Re-ran format:check, typecheck, `npm test` (88/88, 2.7 s) and build: all pass. Read the full diff and every new test.

Accepted. Notes:
- Authority precedence, same-tick coalescing (DOM resume + key edge → one pop), latched pause through candidate replenishment, key-derived owner during a 5-tick catch-up frame, failed-mount terminal phase, registry release paths (completion, restart, stop, dispose, late same-key result) and determinism B are all covered exactly as the plan specified.
- Tests probe release through the public boundary (`game.set(handle)` on a released handle must be rejected and reported) rather than private state — good.
- FINDINGS gained #6–#8 (suspended input, failed replacement recovery, candidate replenishment), all classified with evidence.
- Level 2 geometry (two 5-tile gaps, spikes, three patrols, one-way rows) is plausible on paper; completability is proven in B3 by a headless walkthrough and then checked in a browser.

Committed as `[NGNE-15] Add level progression, pause and completion overlays`.

## Build round B3 — completability evidence + Phase 6 docs (same Codex thread)

Codex added a deterministic test-only auto-player that completes both authored levels (1,448 ticks, 0 deaths, identical repeated enumeration; no level or controller changes needed), `examples/platformer/README.md`, README links, roadmap row/direction, the camera-coordinates contract section, a guide subsection and FINDINGS finalisation (#3 resolved).

### Claude's review

Re-ran format:check, typecheck, `npm test` (89/89), build and `git diff --check`: all pass. Doc facts land in their owning documents (exact camera semantics in the contract, usage in the guide, status in the roadmap, evidence pending in verification). Accepted.

Committed as `[NGNE-15] Add authored-level walkthrough and platformer documentation`. Next: Claude's browser session, then `docs/verification.md`.

## Phase 5 — Claude's browser session and verification record

Chrome 152.0.7977.83 against `npm run dev`, driven through the Claude in Chrome extension with page-world `KeyboardEvent`s on the canvas for held keys. Both authored levels were completed in the browser (level 2 after four failed timed runs: the first timelines mis-modelled the first patrol's direction and left a 4 px margin on the first spikes), plus death/remount, checkpoints, pause by P/Escape/button, resume by button, completion overlay and restart. Tab-hide pause could not be observed through the extension and is recorded as covered by the headless test only. No engine or example console errors. One new finding (#9): a `keydown` with no element target throws inside `Input.attach`'s listener; documented for NGNE-9, not a gameplay defect.

`docs/verification.md` gained the dated NGNE-15 section; roadmap "Next validation" updated. Final checks: format, typecheck, 89/89 tests. Committed as `[NGNE-15] Record platformer verification and findings`.

## Outcome

Plan: 4 review rounds, 21/21 findings accepted. Build: 3 Codex rounds, all accepted by Claude after independent checks, zero engine changes, 23 tests added. Jira NGNE-15 left In Progress for the user's Done decision; NGNE-26 owns the platformer performance measurement.
