# NGNE-27 plan review log

Append-only. Started 13 September 2026.

## Roles and limits

- Planner/orchestrator: Claude Code (Opus 5). Reviewer: Codex CLI 0.154.0, model pinned
  `gpt-5.6-sol` ("Sol") on every call; the config default `gpt-6-astra` is not used.
- Codex runs read-only: `codex exec -s read-only` for round 1, `-c sandbox_mode="read-only"` on
  every resume of the same session. MAX_ROUNDS=5.
- Plan: `plans/NGNE-27-game-migration.md`. Planning only: no production code, tests, commits,
  push or Jira writes.
- If Codex fails (usage limit, CLI error, timeout), the loop stops and the user is told. No
  reviewer or provider substitution.

## Recon

- Jira NGNE-27 read live (cloudId `80938ecc-9e5c-44a3-95c2-c417283ea3ea`): 5 required-work items,
  7 acceptance criteria, validation list, documentation owners.
- Read AGENTS.md, RULES.md, architecture, decisions, contract, guide, roadmap, verification,
  NGNE-21 plan and review log handoff.
- Verified in code: legacy `Renderer` in `src/renderer.ts` (shares file with `Frame`/`Sprite`);
  `BrowserOptions.renderer` at `src/browser.ts:29` with WebGL-only branches at :232–237 and :264;
  object bridge entirely in `src/ecs.ts`; `demo/main.ts:252-258` manual atlas upload after start;
  `Frame.add` inlining note in decisions; both games use public imports only; hello diagnostic
  pattern at `examples/hello/main.ts:10-22`; roadmap/contract confirm NGNE-27 removes all three
  temporaries.
- Bridge removal also affects `tests/engine.test.ts`, `simulation.contract.test.ts`,
  `ownership.test.ts`, `game.test.ts`, `api-misuse.ts`, `benchmark.ts` and the WebGL browser checks.
- Existing focused-test coverage for the four NGNE-20 follow-ups is absent or partial
  (`tests/ecs-soa.test.ts:103-123, 252-272, 385-408`).

## Round 1 — REVISE

Codex `gpt-5.6-sol`, fresh read-only session `01a099c6-4920-7010-a9a5-cce377c7007e`. Full critique:

## Findings

1. **High — Phase 4’s `Frame` rename omits required source and test importers.**

   Evidence: The phase lists only five `src/` files and treats any other `src/` edit as an escalation ([plan:65](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:65), [plan:92](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:92)), but `Frame` is imported from `renderer.ts` by [quad-renderer.ts:12](C:/Users/jfabi/Documents/Projects/tests/ngne/src/quad-renderer.ts:12), [webgpu-renderer.ts:2](C:/Users/jfabi/Documents/Projects/tests/ngne/src/webgpu-renderer.ts:2), [webgpu-runtime.ts:4](C:/Users/jfabi/Documents/Projects/tests/ngne/src/webgpu-runtime.ts:4), [frame-values.ts:1](C:/Users/jfabi/Documents/Projects/tests/ngne/tests/frame-values.ts:1), and several WebGPU tests.

   Fix: Keep `Frame`/`Sprite` in `renderer.ts` and delete only the WebGL class, or enumerate every importer in phase 4 and exempt those mechanical edits from escalation.

2. **High — A1 never proves a complete Starfall playthrough on WebGPU.**

   Evidence: A1 promises both games complete their playthroughs ([plan:21](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:21)), but phase 3 only starts Flight, pauses, and launches Chaos ([plan:193](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:193)). A normal Starfall run completes after 180 seconds and publishes the result scene ([game.ts:218](C:/Users/jfabi/Documents/Projects/tests/ngne/demo/game.ts:218), [game.ts:245](C:/Users/jfabi/Documents/Projects/tests/ngne/demo/game.ts:245)); neither the win/death result nor “Fly again” path is exercised.

   Fix: Require one normal WebGPU browser run through `dead` or `won`, verify result state and durable counters, then start another flight.

3. **High — The plan cannot close A2 because deployed Pages evidence is outside every completion gate.**

   Evidence: A2 explicitly requires the deployed showcase ([plan:22](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:22)), but deployment is left pending ([plan:218](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:218)) and phase 5 can finish without a commit ([plan:237](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:237)); Pages only deploys after a push to `main` ([ci.yml:26](C:/Users/jfabi/Documents/Projects/tests/ngne/.github/workflows/ci.yml:26)).

   Fix: Add an explicitly authorized post-push phase that verifies the CI deployment and all three live URLs, and forbid A2/Jira/roadmap completion before it passes.

4. **High — Starfall pre/post parity can be waived with an unverifiable “chunk-order explanation.”**

   Evidence: The baseline records only periodic sprite counts and peak slots ([plan:135](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:135)); phase 3 permits divergence if it is “explained” by chunk order ([plan:190](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:190)). Chunk-local swap removal genuinely changes traversal order ([contract:142](C:/Users/jfabi/Documents/Projects/tests/ngne/docs/contracts/NGNE.md:142)), but the plan defines no fields, bounds, or causal test that distinguishes expected reordering from a bad port.

   Fix: Define an exact per-sample oracle—durable state, RNG snapshots, per-kind counts, active/hp totals, and frame count—and predeclare which fields may differ; otherwise a mismatch must stop.

5. **High — The historical Chaos A/B does not isolate NGNE-20.**

   Evidence: The plan runs each revision’s own whole benchmark and attributes ordered medians to the bridge refactor ([plan:134](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:134)). Before Chaos, `a906f3a:tests/benchmark.ts:15-34` runs the legacy object ECS workload, while the NGNE-20 benchmark runs a materially different typed-array workload ([benchmark.ts:21](C:/Users/jfabi/Documents/Projects/tests/ngne/tests/benchmark.ts:21)); allocation, GC, and JIT state therefore differ before the measured Chaos section.

   Fix: Run one identical Chaos-only harness against both exported revisions in alternating fresh processes, with no preceding ECS workload.

6. **Medium — The 20% Chaos stop rule claims same-session evidence that phase 3 does not collect.**

   Evidence: The trigger compares against a “same-session pre-build p50” ([plan:73](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:73)), while phase 3 explicitly says the comparison is a new session ([plan:190](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:190)).

   Fix: In phase 3, interleave a preserved pre-build export and the migrated worktree using the identical Chaos-only harness, or remove the same-session threshold claim.

7. **Medium — The descriptor benchmark does not specify an attribution-safe timed boundary.**

   Evidence: The plan says each sample performs a commit and traversal ([plan:156](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:156)); `commit()` both advances the epoch and performs queue work ([ecs.ts:653](C:/Users/jfabi/Documents/Projects/tests/ngne/src/ecs.ts:653)), while descriptor rebuilding occurs only on the first traversal in that epoch ([ecs.ts:328](C:/Users/jfabi/Documents/Projects/tests/ngne/src/ecs.ts:328)). Timing both cannot identify descriptor reconstruction cost.

   Fix: Put the no-op commit outside the timer, time the first and second identical traversals in each epoch, and report their paired delta plus commit time separately.

8. **Medium — The proposed atlas lease test is headless and therefore skips WebGPU ownership.**

   Evidence: Phase 3 calls for a headless lease-count test ([plan:189](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:189)), but headless preparation has no GPU hook ([contract:423](C:/Users/jfabi/Documents/Projects/tests/ngne/docs/contracts/NGNE.md:423)); the renderer’s additional source lease is installed only by `BrowserGame` ([browser.ts:86](C:/Users/jfabi/Documents/Projects/tests/ngne/src/browser.ts:86)).

   Fix: Exercise three Starfall replacements through a WebGPU `BrowserGame` or an injected preparation-hook/renderer integration and assert both scene-consumer and renderer-source lifetimes.

9. **Medium — The “no GPU identity in enumeration” check is incapable of detecting the failure it claims to catch.**

   Evidence: The plan scans `JSON.stringify(app.game.enumerate())` for GPU names and keys ([plan:189](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:189)), but inspection deliberately drops prototypes and non-enumerable state and represents opaque objects as empty records ([contract:28](C:/Users/jfabi/Documents/Projects/tests/ngne/docs/contracts/NGNE.md:28), [contract:90](C:/Users/jfabi/Documents/Projects/tests/ngne/docs/contracts/NGNE.md:90)); scene assets are not enumerated at all ([scene.ts:195](C:/Users/jfabi/Documents/Projects/tests/ngne/src/scene.ts:195)).

   Fix: Replace the string scan with a boundary test proving setup receives decoded `ImageBitmap` values only and no GPU value can enter components/resources, backed by a source/API audit.

10. **Medium — The platformer unsupported-WebGPU test does not specify the action that acquires WebGPU.**

    Evidence: Merely loading the iframe is the stated action ([plan:171](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:171)), but platformer startup happens only after its Start handler calls `launch()` ([main.ts:63](C:/Users/jfabi/Documents/Projects/tests/ngne/examples/platformer/main.ts:63), [main.ts:95](C:/Users/jfabi/Documents/Projects/tests/ngne/examples/platformer/main.ts:95)); renderer acquisition occurs during `BrowserGame.start()` ([browser.ts:226](C:/Users/jfabi/Documents/Projects/tests/ngne/src/browser.ts:226)). The later manual check also defers its exact method ([plan:217](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:217)).

    Fix: Specify the complete fixture DOM, install the `navigator.gpu` override before module import, invoke Start with a real user gesture, and assert the exact persistent message and absence of a scheduled frame.

11. **Medium — Deleting the mixed-mode test also deletes unrelated schema guarantees.**

    Evidence: Phase 4 says to delete that test ([plan:210](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:210)), but the same test covers opaque `WorldAccess`, duplicate schema-query rejection, query encapsulation, borrow expiry, and disposed-world rejection ([ecs-soa.test.ts:427](C:/Users/jfabi/Documents/Projects/tests/ngne/tests/ecs-soa.test.ts:427)).

    Fix: Split the test and delete only legacy/mixed-mode assertions; retain the schema-only authority, duplicate, expiry, and disposal checks.

12. **Medium — Phase 0’s required artifact count is internally impossible.**

    Evidence: Work schedules two HEAD benchmarks plus four A/B invocations ([plan:133](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:133)), but the gate and manual checklist demand eight outputs/runs ([plan:139](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:139), [plan:141](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:141)).

    Fix: Require exactly six raw benchmark outputs—two HEAD and four alternating historical A/B—or explicitly add the missing two runs.

13. **Medium — Final benchmark provenance reports the same revision as the baseline.**

    Evidence: The plan prohibits committing by default ([plan:237](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:237)), while both harnesses identify builds only with `git rev-parse HEAD` ([browser-baseline.ts:354](C:/Users/jfabi/Documents/Projects/tests/ngne/tests/browser-baseline.ts:354), [benchmark.ts:247](C:/Users/jfabi/Documents/Projects/tests/ngne/tests/benchmark.ts:247)). Baseline and migrated output will both claim `12b727e`.

    Fix: Record dirty state plus a SHA-256 of the tested diff/build manifest in every phase 3–5 raw result.

14. **Medium — Required scans use a tool absent from the reviewed execution environment.**

    Evidence: `rg` is mandatory in phase gates ([plan:172](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:172), [plan:205](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:205), [plan:213](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:213)), but the current PowerShell environment reports `rg` as unrecognized.

    Fix: Replace these gates with explicit `Get-ChildItem … | Select-String` commands that include untracked files.

15. **Low — A4 leaves a user-facing WebGL claim in the README artwork.**

    Evidence: README renders the SVG as its first content ([README.md:1](C:/Users/jfabi/Documents/Projects/tests/ngne/README.md:1)), and that asset says `WEBGL 2` ([ngne.svg:11](C:/Users/jfabi/Documents/Projects/tests/ngne/docs/assets/ngne.svg:11)); the file is absent from the ownership table.

    Fix: Add `docs/assets/ngne.svg` to phase 4 and change the label to `WEBGPU`.

16. **Low — The V8 inlining escalation is unenforceable.**

    Evidence: The plan stops if `Frame.add` exceeds the inlining budget ([plan:74](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:74)), but no gate defines the bytecode command or threshold; the historical threshold is only narrative evidence ([decisions.md:43](C:/Users/jfabi/Documents/Projects/tests/ngne/docs/decisions.md:43)).

    Fix: Because `Frame` should remain unchanged, remove this trigger and verify a byte-identical method body; otherwise specify the exact Node bytecode command and 460-byte threshold.

Review lenses applied: `webgpu` for GPU lifecycle/evidence boundaries and `ponytail` for the smaller WebGL deletion path.

VERDICT: REVISE



### Round 1 dispositions (Claude)

| #   | Sev    | Finding                                                        | Disposition                                                                                                                                             |
| --- | ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High   | `Frame` move to `src/frame.ts` misses importers                 | Accepted. `Frame`/`Sprite` stay in `renderer.ts`; only `Renderer` deleted; mechanical importer updates exempt from escalation.                           |
| 2   | High   | A1 lacks a complete Starfall run                                | Accepted. Executor runs a normal flight to result + Fly again; manual full flight added.                                                                 |
| 3   | High   | A2 deployed half outside every gate                             | Accepted. New phase 6 after an authorized push; ticket and roadmap "done" gated on it.                                                                   |
| 4   | High   | Starfall parity waivable by "chunk-order explanation"           | Accepted. Predeclared exact oracle table (state, RNG snapshots, per-kind counts/totals, particles, sprites); only handles/row order may differ.           |
| 5   | High   | Historical A/B polluted by preceding ECS workload               | Accepted. Identical Chaos-only script, fresh process per run, ABABAB.                                                                                    |
| 6   | Medium | 20% trigger claims same-session evidence                        | Accepted. Interleaved pre-build export vs working tree in phases 3–5.                                                                                    |
| 7   | Medium | Epoch arm timing boundary                                       | Accepted. Untimed commit (timed separately), paired first/second traversal and delta.                                                                    |
| 8   | Medium | Headless atlas lease test skips WebGPU ownership                | Accepted. Browser WebGPU `BrowserGame` lifetime check with counting asset and pixel readback; renderer-source count only if reachable without new exports, else a recorded limit. |
| 9   | Medium | Enumerate string scan cannot detect GPU identity                | Accepted. Replaced by decoded-value boundary test plus schema-field/resource audit.                                                                      |
| 10  | Medium | Unsupported fixture lacks acquiring action; manual method vague | Accepted. Reuses NGNE-21 srcdoc technique, stub before import, trusted click for platformer; manual method made concrete with an adapter precondition.   |
| 11  | Medium | Deleting mixed-mode test loses schema guarantees                | Accepted. Split; keep schema-only assertions.                                                                                                             |
| 12  | Medium | Phase 0 artifact counts inconsistent                            | Accepted. Exactly 2 + 6 = 8 bench outputs.                                                                                                                |
| 13  | Medium | Benchmark provenance identical to baseline                      | Accepted. Sidecar manifest (HEAD, porcelain, diff SHA256, untracked hashes).                                                                             |
| 14  | Medium | `rg` missing                                                    | Accepted. All scans use `git grep --untracked`.                                                                                                           |
| 15  | Low    | README SVG says `WEBGL 2`                                       | Accepted. `docs/assets/ngne.svg` added to phase 4.                                                                                                        |
| 16  | Low    | Inlining trigger unenforceable                                  | Accepted. Replaced by byte-identical `Sprite`/`Frame`/`packAffine` diff check.                                                                           |

No findings rejected.

## Round 2 — REVISE

Same Codex session, resumed read-only with `gpt-5.6-sol`. Full critique:

## Findings

1. **High — Starfall’s parity oracle can miss authoritative divergence.**

   Evidence: The oracle omits positions, velocities, cooldowns, ages, and per-entity HP, comparing only aggregates ([plan:139](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:139), [plan:145](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:145)). Schema removal is chunk-local while legacy removal swaps globally ([ecs.ts:735](C:/Users/jfabi/Documents/Projects/tests/ngne/src/ecs.ts:735)); Starfall builds collision buckets in traversal order and accepts the first overlapping target ([game.ts:351](C:/Users/jfabi/Documents/Projects/tests/ngne/demo/game.ts:351), [game.ts:415](C:/Users/jfabi/Documents/Projects/tests/ngne/demo/game.ts:415)). A read-only `seed=bench` probe reached 554 moving rows by tick 240, crossing the 512-row boundary. The plan also gives neither Starfall probe a terminal tick.

   **Fix:** Specify each probe’s terminal condition and compare canonical, row-order-independent hashes of every live component tuple plus resources/state/RNG.

2. **Medium — Round-1 atlas ownership finding remains explicitly waivable.**

   Evidence: Renderer-source lifetime is declared in scope ([plan:58](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:58)), but phase 3 allows merely recording a limit ([plan:286](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:286)). `BrowserGame` acquires and transfers a distinct source lease ([browser.ts:86](C:/Users/jfabi/Documents/Projects/tests/ngne/src/browser.ts:86)), and the intentional internal boundary already exercises source release directly ([image-readiness.test.ts:29](C:/Users/jfabi/Documents/Projects/tests/ngne/tests/image-readiness.test.ts:29)).

   **Fix:** Make renderer-source release mandatory, instrumenting the public asset acquisition/release boundary or the existing intentional internal test boundary across all three replacements.

3. **Medium — The replacement source-scan commands are invalid PowerShell.**

   Evidence: All three commands embed `\"` inside PowerShell double-quoted strings ([plan:168](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:168), [plan:319](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:319), [plan:344](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:344)). PowerShell does not escape quotes with backslashes; parsing the first command reports a missing string terminator.

   **Fix:** Use single-quoted PowerShell regex arguments, e.g. `git grep --untracked -n -E 'from "(\.\./)+src/' -- demo examples`.

4. **High — Phase 6 cannot leave a clean, approved, deployed completion state.**

   Evidence: Independent review and the final gate happen in phase 5 ([plan:376](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:376)); phase 6 then verifies an already-pushed SHA and edits verification/roadmap afterward, with committing those edits optional ([plan:390](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:390), [plan:400](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:400)). Without a second commit, authoritative completion evidence is not delivered; with one, the final SHA was neither inspected nor deployment-verified. Repository rules require owning-document updates in the same task ([RULES.md:173](C:/Users/jfabi/Documents/Projects/tests/ngne/RULES.md:173)).

   **Fix:** Add a mandatory closeout: update docs, run formatting/consistency review, independently inspect, commit/push with authorization, and verify CI/Pages for that final SHA.

5. **Medium — A6’s final benchmark label falsely implies the Frame/GPU differs between arms.**

   Evidence: The plan requires `Frame` to remain byte-identical ([plan:37](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:37)), and the Chaos harness is CPU-only `tick + render + sort` ([plan:113](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:113)). Nevertheless, the final label describes “schema ECS + WebGPU-era Frame (post) vs legacy bridge (pre)” ([plan:370](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:370)); pre-build `12b727e` already uses that same Frame.

   **Fix:** Label both arms as identical CPU Frame/render/sort work with no GPU; identify only Starfall’s schema versus legacy ECS implementation as the runtime variable.

Review lenses applied: `webgpu` for GPU ownership/evidence and `ponytail` for the smallest enforceable corrections. No files were modified.

VERDICT: REVISE


### Round 2 dispositions (Claude)

| #   | Sev    | Finding                                                     | Disposition                                                                                                                                                                                                                                  |
| --- | ------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High   | Starfall aggregate oracle misses divergence; order crosses 512 | Accepted with modification. Canonical sorted-multiset state hash every tick; exact parity only inside a measured order window `W` (all archetypes ≤512 rows), because post-window divergence is legitimate by contract; after `W`, determinism plus terminal condition. Terminal conditions defined. Platformer `W` must cover the whole walkthrough. |
| 2   | Medium | Renderer-source lifetime still waivable                     | Accepted. Mandatory counting via a test-local wrapper on the public `app.game.assets.acquire`; stop if unobservable.                                                                                                                         |
| 3   | Medium | Scan commands invalid PowerShell                            | Accepted. Single-quoted regexes; exit code 1 is the pass condition.                                                                                                                                                                          |
| 4   | High   | Phase 6 cannot end on an inspected, deployed final SHA      | Accepted. C1 (all work) → CI/Pages + user live check → docs-only closeout, inspection → C2 → CI green; C1→C2 diff must be docs-only.                                                                                                        |
| 5   | Medium | Chaos label implies Frame/GPU difference                    | Accepted. CPU-only, identical Frame code; runtime variable is Starfall ECS implementation.                                                                                                                                                    |

## Round 3 — REVISE

Same Codex session, resumed read-only with `gpt-5.6-sol`. Full critique:

The renderer-lease test, PowerShell scans, C1/C2 closeout, and benchmark wording are materially improved. Four blockers remain.

1. **High — Chaos’s order window is guaranteed to fail before tick 1.**

   Evidence: `W` requires every archetype to remain at or below 512 rows and stops if `W < 120` ([plan:148](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:148), [plan:157](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:157)). Chaos creates 6,000 persistent `Particle` rows during setup ([game.ts:196](C:/Users/jfabi/Documents/Projects/tests/ngne/demo/game.ts:196)). Those particles exceed one chunk immediately, although their independent update does not create the collision-order divergence motivating the window.

   **Fix:** Define `W` against the order-sensitive moving archetype—or directly against its first possible cross-chunk reorder—not every archetype.

2. **High — The canonical hash includes a resource whose representation intentionally changes.**

   Evidence: The hash includes every resource value ([plan:143](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:143)), while migration changes `collision-grid` from legacy component objects to chunk views and rows ([plan:292](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:292), [game.ts:131](C:/Users/jfabi/Documents/Projects/tests/ngne/demo/game.ts:131)). Resource inspection copies only enumerable fields ([inspection.ts:36](C:/Users/jfabi/Documents/Projects/tests/ngne/src/inspection.ts:36)), but schema component views expose fields non-enumerably ([ecs.ts:916](C:/Users/jfabi/Documents/Projects/tests/ngne/src/ecs.ts:916)). Therefore the pre/post resource documents differ even inside a valid order window.

   **Fix:** Exclude the explicitly derived `collision-grid` from the authoritative hash and separately prove it is cleared and rebuilt before every read.

3. **High — The 20% migration guard compares divergent workloads.**

   Evidence: Migration A/B times ticks 101–899 and applies the 20% stop trigger ([plan:115](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:115), [plan:125](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:125)), while the parity contract permits gameplay divergence after `W` ([plan:157](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:157)). The final label now explicitly admits that divergence ([plan:391](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:391)). Different entity populations, collisions, and frame counts make the ratio incapable of identifying an ECS regression.

   **Fix:** Apply the ratio and 20% trigger only to exact-parity ticks `101…W`; report the full 900-tick run as non-attributable whole-game evidence.

4. **High — Phase 4 still omits files required for its WebGL gate and deployed UI.**

   Evidence: The deployed root page says `INSTANCED WEBGL 2` ([index.html:166](C:/Users/jfabi/Documents/Projects/tests/ngne/index.html:166)), but `index.html` is absent from phase ownership and the final source scan ([plan:85](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:85), [plan:364](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:364)); phase 6 nevertheless requires no WebGL text ([plan:431](C:/Users/jfabi/Documents/Projects/tests/ngne/plans/NGNE-27-game-migration.md:431)). Conversely, that scan includes tests and will match an unchanged comment in [browser-webgpu-checks.ts:7](C:/Users/jfabi/Documents/Projects/tests/ngne/tests/browser-webgpu-checks.ts:7), which is also absent from phase 4’s file inventory.

   **Fix:** Add `index.html` and `tests/browser-webgpu-checks.ts` to phase 4, update their stale text, and include `index.html` in the zero-match scan.

Review lenses applied: `webgpu` for renderer ownership/evidence and `ponytail` for minimal enforceable fixes. No files were modified.

VERDICT: REVISE


### Round 3 dispositions (Claude)

| #   | Sev  | Finding                                                   | Disposition                                                                                                                                                                                                                         |
| --- | ---- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High | Chaos particles end the order window at tick 0             | Accepted. `W` scoped to order-sensitive archetypes; Starfall particle loop (`demo/game.ts:488-499`) verified per-row independent with no RNG, so it is order-insensitive; executor re-verifies after port. Chaos has no minimum `W`. |
| 2   | High | Hash includes `collision-grid` whose shape changes         | Accepted. Derived caches excluded from the hash; clear/rebuild proven by line citation checked by the inspector plus in-window parity.                                                                                              |
| 3   | High | 20% trigger compares divergent workloads                   | Accepted. Trigger applies only to ticks 101…`W` with ≥100 samples; whole run reported as non-attributable; fallback to the normal scripted run, else an open user decision.                                                         |
| 4   | High | `index.html` and `browser-webgpu-checks.ts` missing        | Accepted. Both added; scan includes `index.html`; pre-edit scan output defines in-scope text edits.                                                                                                                                  |

## Round 4 — APPROVED

Same Codex session, resumed read-only with `gpt-5.6-sol`. Full response:

All four round-3 fixes are real:

- Order window now excludes the independently updated particle archetype.
- Derived collision-grid state is excluded with a rebuild proof.
- The 20% trigger applies only to parity-matched samples.
- `index.html` and the remaining WebGL-comment matches are included in phase 4.

No material new flaws found. Review lenses: `webgpu` and `ponytail`. No files modified.

VERDICT: APPROVED


### Post-approval formatting

Approved file SHA256 `68429b2518359ce92f74074d528211de24ef49a57c4038f5dcb63a8744e6c712`. `prettier --write`
realigned tables and renumbered the one-line stop-report list; Claude restored that list as six
separate items. Whitespace- and dash-padding-insensitive comparison with the approved snapshot:
content-equivalent. Formatted SHA256 `c65c44190c6f9d62f3b746e5d60d50f8ea171929cd4b12e91b5a96b8c14e3b01`.
Sent to the same Codex session for confirmation of the exact formatted file (round 5).

## Round 5 — APPROVED (confirmation)

Same Codex session, resumed read-only with `gpt-5.6-sol`. Full response:

Confirmed:

- SHA-256 is exactly `c65c44190c6f9d62f3b746e5d60d50f8ea171929cd4b12e91b5a96b8c14e3b01`.
- Prettier check passes.
- Stop report retains six separate requirements.
- All approval-critical parity, attribution, ownership, scan, and deployment gates remain substantively unchanged.
- No files modified.

Review lenses: `webgpu` and `ponytail`.

VERDICT: APPROVED


## Final verification

- Converged after 4 substantive rounds plus 1 confirmation round (5 of 5 permitted). 25 findings
  total (R1 16, R2 5, R3 4); all accepted, two with modification (R2-1 order window, R2-2 via
  public-method wrapper). None rejected. No unresolved disagreement.
- Approved plan: `plans/NGNE-27-game-migration.md`,
  SHA256 `c65c44190c6f9d62f3b746e5d60d50f8ea171929cd4b12e91b5a96b8c14e3b01`, Prettier clean.
- Codex ran read-only every round (`-s read-only`, then `-c sandbox_mode="read-only"` on resume);
  `git status` showed only the three untracked `plans/NGNE-27-*` files after each round.
- Codex had no Jira access; Claude read Jira live. No production code, tests, owning docs, commits,
  push or Jira writes. Implementation is not authorized by this planning session.

## User decisions after approval — 13 September 2026

- The user committed and pushed the plan records as `cdf6b37` (plan SHA256 unchanged).
- Executor authorized to commit (phase 6 C1/C2); push to be confirmed once at phase 6 entry.
- No gamepad or touch screen: those manual items are recorded "untested (no device)".
- Builder Claude Opus; phase 5/6 inspector Codex `gpt-5.6-sol` read-only, fresh session.
- Recorded in `plans/NGNE-27-handoff.md` ("User decisions after plan approval"), including the phase 0
  entry-condition reading for HEAD `cdf6b37`. The approved plan file was not modified.
