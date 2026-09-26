# Benchmarks

Run from the repository root with Node 24. Keep benchmark Chrome windows visible.
The entry point uses Node; use `npm.cmd` in Windows PowerShell. Windows execution
was verified in the [dated evidence](../../../docs/evidence/benchmark-migration.md).
Linux benchmark execution is unvalidated and out of scope for the current tooling
migration; no Linux benchmark portability or performance claim is made.

For installed engine resource churn, use
[`npm.cmd run bench:content -- --explore`](content/README.md).
This aliases `bench:engine-content` and prepares its own engine package. Game
transition measurements are consumer-owned; no sibling checkout is selected.
The legacy [content comparator](../../evidence/compare-content.mjs) remains available for retained
old-format runs with its strict identity and cleanup gates.

## Run

```powershell
npm.cmd run bench:all
npm.cmd run bench:all -- -Workload churn
npm.cmd run bench:all -- -Workload churn -Diagnostics -Compact
```

| Option                                | Effect                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `-Workload churn`                     | Run churn only; skip builds and browsers                                    |
| `-Diagnostics`                        | Add churn allocation/GC analysis and browser profiles, snapshots and traces |
| `-Compact`                            | After a successful run, retain only the three files below                   |
| `-WarmupSeconds 1 -DurationSeconds 5` | Short browser smoke test; churn counts stay fixed                           |
| `-SkipBuild`                          | Reuse current `dist/` and `dist-browser/` builds                            |
| `-OutputRoot <directory>`             | Change the output location                                                  |

The default suite builds both artifacts and runs CPU, churn, two renderer fixtures,
Starfall Chaos Lab and Platformer sequentially. Diagnostics run separately from clean churn
measurements and can perturb browser timings.

Each invocation creates a unique directory under `out/runs/`. Namespaced evidence,
raw measurement records and cleanup outcomes live in `evidence/`. The
`evidence/legacy/` projection preserves advisory-reader compatibility:

- `summary.md`: readable status report.
- `analysis.json`: self-contained workload measurements and validation results.
- `manifest.json`: revision, environment, stage status and retention metadata.

Full output also retains logs and profiles. Compact output removes legacy raw artifacts only after
validating the summaries; namespaced raw measurements and command logs remain.
Failed runs retain diagnostics. Cleanup refuses links/junctions and
never prunes historical runs or external temporary directories. Raw profiles cannot be
re-examined after compaction; future comparisons still work.

## Compare

```powershell
npm.cmd run bench:compare -- <baseline-directory> <candidate-directory>
```

Full, compact and older run folders are supported. Reports go under
`.test-output/comparisons/`; use `--output <directory>` to choose another location.
Changes of 10% are attention signals, not statistical verdicts; adjust with
`--attention-percent <number>`.

Use the same machine, power mode, runtime and workload. Repeat measurements in fresh
processes, alternating baseline/candidate order. For replicated churn decisions, stop if
either condition's range exceeds 10% of its median. Otherwise, require non-overlapping
run values and a median difference larger than both ranges. One run cannot establish this.

## Workloads

- **CPU:** ECS traversal, Chaos simulation/render preparation, collision-grid lookup and
  first/second traversal after commit. Run separately with `npm.cmd run bench`.
- **Churn:** 10,000 live entities, 1,000 replacements per batch, 100 warmups and 1,000 samples.
  Batch timing includes component authoring, despawn/spawn queueing and commit; no queries.
  Diagnostics capture allocation and GC, and validate trace alignment automatically.
- **Browser:** hardware WebGPU, two 10,000-sprite renderer fixtures and both games.
  Defaults are 10 seconds warmup and 60 seconds sampling. Results include visibility,
  build identity, frame timing, dropped ticks and process cleanup.

CPU measurements do not measure GPU execution. Allocation bytes per batch are descriptive;
a faster workload can allocate more bytes per second while allocating less per batch.
Browser heap movement alone is not evidence of a leak. Replicated A/B orchestration remains
manual; this runner executes one sample run per selected workload and mode.
CPU, private renderer and repository showcase probes are explicitly internal-source
microbenchmarks, with source/build inventories; they do not establish installed-package
acceptance. Their implementation lives in `tooling/suites/benchmarks/`; the browser
page lives in `rendering/browser/` and imports the renderer implementation directly. The installed
resource workload above tests the exact fresh tarball. The aggregate suite is
exploratory; named physical-environment baseline collection and measured-budget
acceptance currently apply to that installed resource workload.

The original PowerShell files are retired after Windows replacement checks;
`bench:all` uses Node. Both original flag spellings and kebab-case forms (for example `--workload`,
`--warmup-seconds`, `--output-root`, `--diagnostics`, `--compact`) are supported.
Pass `evidence/legacy/` explicitly to the advisory comparator. No automatic latest-run
selection occurs.
