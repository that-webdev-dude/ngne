# NGNE-12 handoff for the phase 4 executor

Addressed to the executor (Claude Opus) continuing NGNE-12 session 1, "Measure and diagnose the SoA
and WebGPU migration", from phase 4 to its close. Written 16 September 2026.

## Inputs

| Item                | Value                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| HEAD                | `86494fd2bcdea81bc48dc9b7fe7d0b0efb942947` (R2); nothing committed for NGNE-12 yet                          |
| Approved plan       | `plans/NGNE-12-measurement.md`, SHA256 `279a8e7eeedcb8a7e438c90a108e7f6386808147a85497a834b357263b0caf9b`   |
| Review log          | `plans/NGNE-12-review-log.md` (round 4 approval)                                                            |
| Jira                | NGNE-12, cloudId `80938ecc-9e5c-44a3-95c2-c417283ea3ea` (read only, no writes)                              |
| Evidence            | `docs/verification.md`, section `## NGNE-12` (phases 0–3)                                                   |
| Raw diagnostics     | `C:/Users/jfabi/AppData/Local/Temp/ngne-12-diagnostics/` (exports, scripts, manifests, raw results)         |
| Uncommitted changes | `docs/verification.md`, `tests/browser-baseline.ts` (phase 1 driver); untracked `plans/NGNE-12-*` (3 files) |

Before phase 4: verify the plan SHA256, HEAD and `git status --porcelain` (only the files above), and
re-read Jira NGNE-12. On any mismatch or material Jira change, stop and report.

## State

| Phase             | Status                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| 0. Entry, exports | Validated                                                                                               |
| 1. Harness        | Validated                                                                                               |
| 2. CPU            | Validated; 104/104 Node runs accepted; machine idle confirmed                                           |
| 3. Browser        | Closed by the user with existing data: blocks 1 and 2 (69/69 runs accepted); confirmation matrix waived |
| 4. Analysis       | Validated; Codex APPROVED (round 3); S1-C1 `e5a9fb3`                                                                                                 |
| 5. Decision       | Done: U1–U4 accepted, all gaps waived, Codex check skipped by the user; NGNE-12 complete |

## User decisions (dated; they do not change the plan hash)

- **15 Sept, phase 0:** the renderer fixture is served from a diagnostic `validation.html`-only build
  (`dist-fixture/`), recorded under "Renderer fixture serving".
- **15 Sept, phase 2:** no rule change. The same-revision churn time comparison (schema 7.7× object,
  fully separated) stays "within run noise (noise stop)"; allocation bytes per commit stays
  descriptive, bytes per commit-second is the decision metric.
- **15 Sept, phase 3:** leaner reporting. Scripts write result tables straight into
  `docs/verification.md` (UTF-8, no BOM, then Prettier); the chat gets only headlines, rejections and
  classifications. Apply this to phase 4 tables.
- **16 Sept, phase 3:** skip block 3; **waive `confirm-starfall300`** (triggered only by an R0 leak
  candidate); proceed to phase 4 with the existing data and close NGNE-12.
- **16 Sept, phase 4 entry:** block 2 confirmed uninterrupted (recorded in the verification
  section); S1-C1 authorized as commit, no push.
- **16 Sept, phase 5:** U1–U4 accepted, all five gaps waived, Codex inspection of the docs-only delta
  skipped; S1-C2 authorized as commit, no push.
- **Commits:** ask at phase 4 entry (S1-C1) and phase 5 (S1-C2); one-line `[NGNE-12] <message>`, **no
  co-author line**. Push only when the user says so. No Jira writes.

## Execution protocol

- One phase at a time. At the end of each phase run its gate, send the plan's stop report, then stop
  and wait for explicit validation. Never merge, skip or reorder phases.
- Session 1 never changes `src/`, `demo/`, `examples/`, `index.html` or `validation.html`; anything
  needing that is a session 2 candidate.
- `MANUAL (user)` items are handed over with steps and pass criteria; never simulated.
- Inspector: Codex `gpt-5.6-sol`, read-only, a fresh session
  (`codex exec -m gpt-5.6-sol -s read-only`; resumes add `-c sandbox_mode="read-only"` and repeat
  `-m gpt-5.6-sol`). Never `gpt-6-astra`. If Codex is unavailable after one retry, stop and tell the
  user.
- Context hygiene: read file ranges; pipe long output through `head`/`wc`; do not paste raw tables.

## Pending at phase 4 entry

1. **MANUAL (user):** block 2 (15 Sept, 18:36–19:55 UTC) uninterrupted confirmation. Ask once; record
   the answer in "Phase 3 decisions and checks".
2. **S1-C1 authorization:** ask once whether to commit (and whether to push) at the end of phase 4.

## Phase 4 work

The plan's phase 4 section is authoritative. Where to find each input:

| Need                      | Source                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node matrices             | `node/phase2-analysis.json` (`5294da919c6f`); tables in "CPU measurements (phase 2)"                                                                                                  |
| Browser matrices          | `browser/phase3-analysis.json` (`9cbd92997c61`): `starfall60`, `platformer60`, `fixture-one`, `fixture-alt`, `rs-starfall60`, `rs-platformer60`                                       |
| Profiles (cause evidence) | `profiles/profile-<W>-<rev>.summary.json`, `profiles/diff-*.json`                                                                                                                     |
| Allocation sites          | `browser/phase3/<matrix>/<run>/sites.json` (games, RS submatrices, long runs)                                                                                                         |
| Snapshot retainers        | `browser/phase3/{starfall300,cycle-*}/<run>/snapshot-diff.json` and `classification.json`                                                                                             |
| GPU-process traces        | `browser/phase3/trace-*/<run>/trace-summary.json` (descriptive only)                                                                                                                  |
| Scripts to reuse          | `scripts/phase2-analyze.mjs`, `phase3-analyze.mjs`, `phase3-report.mjs` (writes a marked section into the doc), `profile-diff.mjs`, `manifest.sh`; hashes in the verification section |

Steps:

1. Write a `phase4-report.mjs` (diagnostics `scripts/`) that builds the before/after tables per
   workload and metric and the regression table from the two analysis JSONs by the plan's
   predeclared rules, writing into a marked section of `docs/verification.md`. Regression: R0→R2
   attributable and at least one of CPU p50/p95 +5% (attributable window), browser callback p95
   +10%, allocation rate +25%, GC pause total +25% (Node `--trace-gc` only), dropped ticks in every
   R2 run and no R0 run, or a confirmed leak. Attributable but smaller: minor. Noise stop: never a
   verdict.
2. For each regression: size, per-pair attribution (R0→RS, RS→R1, R1→R2 where a matrix provides
   them; name missing pairs), cause evidence, confidence, proposed fix direction and closure target.
3. Rank regressions by frame-budget headroom and memory over a 10-minute session.
4. Minor and within-noise results; evidence gaps; local limits (one machine, one Intel GPU, Chrome
   152, 0.1 ms page timer resolution).
5. `docs/roadmap.md`: NGNE-12 measured; fixes pending the user's selection.
6. Fresh Codex read-only inspection of the session 1 diff, manifests and artifacts against the plan
   (rules as predeclared, balanced blocks, no dropped runs, claims no stronger than evidence,
   protected paths untouched, and the recorded user deviations above). Fix and resume the same
   session until APPROVED; record the rounds.
7. `npm.cmd run format`, standard gate, protected-path scan, commit S1-C1 only as authorized.

## Facts phase 4 must carry

Observations already recorded in the verification section (not yet classified):

- **Chaos (Node), R0→R2 in `W` = 237:** nothing attributable; p95/p99 mostly noise-stopped. R1→R2 sum
  p50 +4.0% and preparation p50 +2.6% attributable (pair evidence only).
- **Chaos sort p99:** 0.14 ms (R0) → 0.37 (R1) → 0.62–0.68 (R2), noise-stopped on every pair.
- **Same-revision churn at RS:** schema 7.7× object per commit (noise stop), 5.6× bytes per commit
  (descriptive); the cost persists at R2 (`churn-schema.ts` RS→R2 within noise).
- **Starfall 60 s, R0→R2:** callback p50 +18.2%, p95 +10.3% (noise stop, ranges 19–31%); allocation
  -61% (attributable); reclaimed rate within noise; retained after warmup +1.5 MiB (descriptive);
  0 dropped ticks. R1 is the low point of reclaimed rate and heap maxima (NGNE-27 lead explained).
- **R2 allocation sites:** `demo/game.ts` chunk callbacks and `createChunkDescriptor`
  (`dist/engine/ecs.js:537`), both games.
- **Platformer 60 s, R0→R2:** allocation -8.0%, reclaimed -15.6% (attributable improvements);
  callbacks noise-stopped.
- **Fixture R1 WebGPU→R2 WebGPU:** no attributable difference; WebGPU far ahead of WebGL in R1.
- **RS submatrices:** browser allocation decrease sits at RS→R1 (NGNE-21) in both games.
- **Long and cycle runs (descriptive):** R0 `starfall300` leak candidate (+1.17 MiB); R2 unclassified
  (retained -1.0 MiB); all cycle runs unclassified with R0 and R2 growth within 0.05 MiB.

## Evidence gaps for phase 5

The user must plan or waive each (the plan requires this before NGNE-12 can close):

1. **GPU execution time:** unavailable without an engine change; the adapter exposes
   `timestamp-query` but the engine requests no features (`src/gpu-context.ts`).
2. **Leak confirmation:** `confirm-starfall300` waived; no replicated leak or bounded-cache
   classification exists for any revision.
3. **Noise-stopped comparisons:** Starfall callback p95/p99, Chaos p95/p99 and sort p99, churn p99
   and GC pause totals, same-revision churn time; reported as narrowed, never as verdicts.

## Phase 5 and closing NGNE-12

Follow the plan's phase 5: ask which regressions to fix or accept and how to handle each gap. If
nothing is selected and every gap is waived: record the decisions, mark NGNE-12 done in
`docs/roadmap.md`, standard gate, Codex read-only inspection of the docs-only delta, commit S1-C2 as
authorized. Otherwise write `plans/NGNE-12-fixes.md` per "Session 2 plan requirements", run the
Codex adversarial review (same session, at most 5 rounds, Prettier before hashing), append the rounds
to the review log, commit S1-C2 as authorized, and do not start session 2 (NGNE-12 then stays open
until session 2 finishes).

## Stop and escalate

The plan's "Stop and escalate" list applies, including: any needed change under protected paths, a
predeclared rule changed after seeing data, environment contradictions, and scope creep (fixes, CI
gates for NGNE-13, other devices for NGNE-14).

## Environment

- Windows 11, i7-12650H, Chrome 152 headful over CDP, Intel `gen-12lp`, DPR 1, mains power.
- `npm.cmd` on Windows; scans with embedded quotes in Git Bash (PowerShell 5.1 strips quotes).
- Repository files are written with Edit/Write or Node scripts (never PowerShell `Set-Content`).
- `gh` is not installed; GitHub API through `curl --ssl-no-revoke`.
- No further browser runs are planned; if any become necessary, stop and ask (headful Chrome over
  CDP only, never the in-app Browser pane).
