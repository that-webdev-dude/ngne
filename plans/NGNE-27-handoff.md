# NGNE-27 handoff for the session-2 executor

Addressed to the executor (Claude or Codex) implementing NGNE-27, "Migrate Starfall and the
platformer to SoA and WebGPU".

## Inputs

| Item            | Value                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Pre-build HEAD  | `12b727e7f095a3ddd763724190a9d12ace6d2d76` (`[NGNE-21] Replace WebGL renderer and asset upload with WebGPU`)                  |
| Approved plan   | `plans/NGNE-27-game-migration.md`                                                                                             |
| Plan SHA256     | `c65c44190c6f9d62f3b746e5d60d50f8ea171929cd4b12e91b5a96b8c14e3b01` (Codex `gpt-5.6-sol`, APPROVED round 4, confirmed round 5) |
| Review log      | `plans/NGNE-27-review-log.md`                                                                                                 |
| Jira            | NGNE-27, cloudId `80938ecc-9e5c-44a3-95c2-c417283ea3ea` (read only)                                                           |
| Target hardware | Windows 11, Chromium 152, Intel `gen-12lp` WebGPU, secure localhost                                                           |

Before phase 0: verify the plan SHA256 matches, HEAD matches (or report the actual HEAD and stop),
and re-read Jira NGNE-27. If Jira changed materially, stop and report.

## Execution protocol

> Execute ONE phase at a time. Never run multiple phases in one go. At the end of each
> phase: run that phase's automated gate, then STOP. Report what changed, exact check
> results, the MANUAL (user) checks pending with steps, and any open decision. Wait for
> the user's explicit validation before starting the next phase. If a gate fails, fix
> within the phase (at most two attempts) or stop and report. Do not skip, reorder or
> merge phases without the user's approval.

**The user is available for manual checks whenever a phase needs them.** Hand the check over
and wait; never substitute a simulated check for a `MANUAL (user)` item, and never mark one
passed without the user's confirmation.

## Phases and entry conditions

The plan is authoritative for each phase's files, work, automated gate, `MANUAL (user)` checks,
docs and stop report. Summary:

| Phase                                      | Entry condition                                                                                  | Key gate beyond the standard gate                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 0. Baseline and provenance                 | Plan hash and HEAD match; only `plans/NGNE-27-*` untracked                                       | 8 bench outputs (2 HEAD + 6 attribution A/B), 3 parity captures with order windows, 4 visible browser runs, WebGL screenshots |
| 1. NGNE-20 follow-ups                      | Phase 0 validated by the user, including visible-run and WebGL reference-play checks             | +4 focused ECS tests; paired epoch arm; inventory rows (user reads)                                                           |
| 2. Platformer port, NGNE-15 replay         | Phase 1 validated                                                                                | Exact hash parity over the whole walkthrough; unsupported fixture; user keyboard/audio playthrough                            |
| 3. Starfall port, NGNE-9/10 replay         | Phase 2 validated, including its `MANUAL (user)` checks                                          | In-window parity + determinism; atlas lease lifetime; A/B trigger; run to result + Fly again; user input/visual/audio checks  |
| 4. Remove WebGL and the bridge             | Phase 3 validated; legacy-use scan returns nothing                                               | WebGL scan returns nothing; `Frame` byte-identical; production preview; user unsupported-browser check                        |
| 5. Measurements, final docs and inspection | Phase 4 validated                                                                                | Post-migration visible runs; final A/B; fresh read-only inspection; request commit/push authorization                         |
| 6. Deployment closeout                     | Phase 5 validated and explicit authorization for both commits/pushes (or the user performs them) | C1 CI/Pages green + user live check; docs-only C2; C1→C2 diff docs-only                                                       |

Phase 6 is the only phase that commits or pushes, and only as the user authorizes. NGNE-27 is not
complete, and the roadmap must not say so, until phase 6 passes.

## Stop and escalate

Stop, report and wait for the user when:

- **An API contract change is needed** beyond the removals the plan lists for phase 4. Record the
  friction (symptom, call site, why no supported API works, proposed contract change, alternatives).
  Never add a game-side workaround, cast, private import or shim.
- **An acceptance criterion cannot be met.**
- **Hardware or browser evidence contradicts an assumption** in the plan.
- **Scope creep beyond the plan**, including NGNE-12/13/14 work.
- Any additional trigger listed in the plan's "Stop and escalate" section: a parity/determinism
  oracle failing after two fix attempts, the >20% attributable-window A/B trigger, or any change
  inside `Sprite`, `Frame` or `packAffine`.

## Repository rules

- If Codex, Claude or any tool used for inspection becomes unavailable, stop and tell the user;
  never swap the inspector or provider silently.
- No commits, push or Jira writes unless the user asks. Commits use the one-line
  `[NGNE-27] <message>` format from AGENTS.md (no co-authors, no multi-line messages).
- Follow RULES.md; update the owning document in the phase that changes its fact; preserve prior
  dated evidence in `docs/verification.md` and add NGNE-27 evidence in a new section.
- Windows commands use `npm.cmd`. Raw diagnostics stay outside the checkout.
