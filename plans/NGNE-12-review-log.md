# NGNE-12 plan review log

Append-only. Reviewer: Codex `gpt-5.6-sol`, read-only (`codex exec -m gpt-5.6-sol -s read-only`).

## Session 1 plan (`plans/NGNE-12-measurement.md`)

Planning session 14 September 2026. Builder: Claude Opus.

### Round 1 — REVISE (11 findings)

Plan SHA256 reviewed: `2e6dd5803f59de940a257a13555e48974e81fd8904cd9e23b2218977b0c0dd0e`.
Codex session `01a0a15a-1083-7672-a206-f154d0a585e4`.

| #   | Severity | Finding                                                                                          | Disposition                                                                                                                                   |
| --- | -------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | R0→R1 confounds NGNE-20 SoA with NGNE-21 shared path and `Frame` widening                        | Accepted: RS `9c00f02` added to every Node arm; to browser runs only where R0→R1 is attributable (bounds machine time); renderer fixture pair |
| 2   | High     | Browser result not bound to the served export (port fallback, surviving Chrome, driver revision) | Accepted without page changes: `--strictPort`, unique CDP port and profile, owned PIDs, served-asset hash check against export `dist/`        |
| 3   | High     | Frame preparation and GPU upload/render could stay unmeasured; "unavailable" allowed completion  | Accepted: Chaos split timing, R1 dual-mode renderer fixture, trace alignment proof, GPU execution time a required gap (plan or waive)         |
| 4   | High     | Churn arm only on SoA revisions and warm-state coupled to bench; f32/f64 order fixed             | Accepted: standalone object and schema churn scripts with equivalence table; `benchmark.ts` untouched; alternating width order                |
| 5   | High     | Single runs and unbalanced rotation; p50-only noise rule                                         | Accepted: Latin-square blocks, replicated vs descriptive workloads, confirmation runs, per-metric attribution and noise                       |
| 6   | High     | Allocations/GC not actually measured in game modes; long tasks unwindowed                        | Accepted: game-mode sampling with GC-collected objects, windowed long tasks, GC trace events, distinct allocation/reclaim/GC/retained metrics |
| 7   | Medium   | R2 WebGPU probe does not identify R0/R1 active backend                                           | Accepted: backend and renderer string assertion, software fallback rejection                                                                  |
| 8   | Medium   | Clicks do not prove cycles; cache vs leak rule too weak                                          | Accepted: completion oracles, expected cardinalities, listed caches with bounds, slope rule across replicated runs                            |
| 9   | Medium   | Driver ignores CDP events; snapshots/traces could be empty                                       | Accepted: event dispatch, stream traces, artifact validity gate                                                                               |
| 10  | High     | Session 2 "fixed" undefined; cumulative comparisons mask per-fix effects                         | Accepted: closure targets, non-inferiority bounds, parent→child A/B plus cumulative vs R2, full affected-matrix closeout                      |
| 11  | Low      | Wrong citation for WebGPU features                                                               | Accepted: `src/gpu-context.ts:30` `requestDevice()`; phase 0 records `adapter.features`                                                       |

### Round 2 — REVISE (7 findings)

Plan SHA256 reviewed: `3afaccad8cc2f7694afd29cd70e4bc9cc2bb41473d1403a22b49c3df98fa95e8` (Codex verified).
Same Codex session. Codex confirmed the descriptive/replicated scoping is sound, and the conditional RS
scoping sound only with a fresh submatrix.

| #   | Severity | Finding                                                                     | Disposition                                                                                                                                      |
| --- | -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | High     | R0→RS mislabelled as SoA storage; games stay on object columns at RS        | Accepted: relabelled; same-revision RS object-versus-schema churn matrix declared the causal SoA comparison                                      |
| 2   | High     | `heapUsed` deltas are not allocation rate; `--trace-gc` perturbs timed runs | Accepted: timed runs time only; separate in-process inspector allocation sampling and `--trace-gc` runs; forced-GC heap is retained only         |
| 3   | High     | Balancing rules contradict tables (fixture, conditional RS, confirmation)   | Accepted: explicit matrix table; two 3-condition fixture matrices; fresh R0/RS/R1 submatrix; fresh confirmation matrix, descriptive run excluded |
| 4   | Medium   | More repeats cannot shrink a range-based noise stop                         | Accepted: range-triggered comparisons are narrowed or abandoned, never extended                                                                  |
| 5   | Medium   | `--cpu-prof` cannot isolate the attributable window                         | Accepted: separate profiling runs start and stop `node:inspector` `Profiler` around ticks 101…W                                                  |
| 6   | Medium   | Production builds emit no source maps                                       | Accepted: hidden-map build served only if JS assets are byte-identical to the plain build; otherwise unambiguous functions only                  |
| 7   | Low      | R1 in descriptive long/cycle runs adds cost without decision value          | Accepted: descriptive long and cycle runs on R0 and R2; R1 enters through the confirmation matrix                                                |

### Round 3 — REVISE (4 findings)

Plan SHA256 reviewed: `f4a471b3f6bbd4175f7f6c699edb487fd1f911435a908f1c460f0ff34be433a5` (Codex verified).
Same Codex session; round 2 findings confirmed resolved.

| #   | Severity | Finding                                                                     | Disposition                                                                                                                                                                           |
| --- | -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | Churn allocation and GC runs were single runs but decision metrics          | Accepted: both repeat with their timing matrix's conditions, Latin square and run counts                                                                                              |
| 2   | High     | Trace-derived GC pause had no confirmation path yet fed the regression rule | Accepted: trace metrics descriptive only; GC pause regression limited to Node `--trace-gc` matrices                                                                                   |
| 3   | High     | Leak rule missed a worsened R0 leak; bounded-cache confirmation unreachable | Accepted: per-revision leak presence; confirmed leak = R2 leak presence with slope attributably above R0; confirmation triggered for any leak/cache classification used in a decision |
| 4   | Medium   | Rerunning only a rejected position breaks Latin-square balance              | Accepted: a rejected run rejects its block; the complete row is rerun and raw results kept                                                                                            |

### Round 4 — APPROVED

Same Codex session; no findings. Round 3 findings confirmed resolved.

**Approved plan SHA256 (Prettier-formatted, verified by Codex):**
`279a8e7eeedcb8a7e438c90a108e7f6386808147a85497a834b357263b0caf9b`
