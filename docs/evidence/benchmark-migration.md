# Benchmark migration evidence

Recorded 2026-09-24 on Windows 11, Node 24.15.0 and Chrome 153.0.8010.53.
The parent revision is `73f94d2b77dded107a32203018b0630ebefb123c`; measured
source identities, run IDs, results and retention limits are in
[the machine record](benchmark-migration.json). This is dated evidence, not a
current performance guarantee.

CPU, churn, private renderer and repository showcase probes now execute through
Node orchestration with their implementations under `tooling/suites/benchmarks/`.
They explicitly identify internal source targets and retain source/build hashes.
The installed resource workload separately prepares and installs the exact tarball.
No engine public API or external consumer source changed.

The [named environment profile](../../tooling/profiles/environments/windows-intel-gen12-chrome153.json)
records observed CPU, memory, OS, Node, browser, launch flags, viewport, DPR,
visibility and non-fallback Intel gen-12lp adapter. The installed resource fixture
uses seed 1, thirteen deterministically generated images, twelve scenes, twelve
warmup transitions and 120 measured transitions per repetition. Three repetitions
use root, nested and root URL bases. Asset accounting is separate from V8 heap,
process memory and driver memory.

Three independent full baseline invocations supplied nine repetition p95 values.
The [measured budget](engine-resource-budget-2026-09-24.json) is **70.8 ms**:
the maximum observed repetition p95, 59 ms, plus explicit 20% engineering
headroom. This local latency guard is not a significance test, hardware-independent
target, engine speedup or transplanted consumer budget. All attempts are retained.
Workload/harness/toolchain drift requires remeasurement; a name alone never
establishes environment equivalence. Machine power mode and unrelated background
activity were not independently instrumented.

The isolated source copy contains current inventoried source, Git metadata and
labeled historical evidence, but no consumer sibling, active game snapshot,
consumer install/build, or earlier runtime outputs. It uses an explicitly recorded
junction to the existing toolchain dependencies. Every installed resource run
creates its own fresh offline engine installation. This is consumer-independence
evidence, not a fresh dependency-install or offline reproduction claim.

Original flag aliases remain accepted by the Node runner, including build reuse,
output selection, browser URL/port, warmup/duration, churn-only mode, diagnostics
and compaction. Node compaction verifies the legacy projection before pruning,
refuses links and escaping/mismatched paths, records deletion failures and retains
failed-run diagnostics. Namespaced raw measurement records and command logs remain
even when the legacy projection is compacted. The unchanged advisory comparator
can read that explicitly selected projection; no strict/candidate comparator work
is included.

The two PowerShell files are retired after scoped Windows replacement checks and
a zero-live-caller audit. Their original bytes are retained in the raw archive.
The migration checker is unchanged. Compatibility source entry points, legacy
readers/comparators and export obligations keep their separate retirement gates.
Existing historical artifacts and previously approved proofs remain unchanged.

Three full baselines and two consecutive controlled invocations passed under the
final content harness, including 360 transitions, nine cancellation checks and
three terminal disposals per invocation. A default-duration aggregate passed;
after a failure-reporting correction, two consecutive short aggregate executions
also passed, one with diagnostics and compaction. No manual cleanup was needed
between those successful invocations. Earlier hidden-page and cleanup-timeout
failures remain failures in the evidence, even though a later PID audit found no
surviving owned processes. The corrected failure path has regression coverage.

The [raw archive](benchmark-migration-raw.json.gz) retains dated manifests,
results, raw measurements, packages, available matching source and command logs.
Its explicit omissions identify large optional heap/allocation/trace payloads
retained locally. It is not the general portable exporter or a resumable
preparation export. Full-default aggregate evidence predates the reporting-only
correction; the two later short aggregates cover the corrected runner.

The final [CPU supplement](benchmark-cpu-raw.json.gz) retains all six raw series,
including collision-grid and epoch traversal arrays added after aggregate runs.
Their sample counts and p50/p95/p99 values were checked against the emitted
summaries. This standalone run and subsequent typecheck cover the additive output
change; earlier aggregate artifacts retain their original summary-only limits.
Post-retirement regression tests passed 272/272 with no skips. Formatting,
tooling typechecking and migration checks passed; 120 unrelated retirement
obligations remain blocked.

Linux execution is outstanding: WSL is not installed and no Linux/hosted delivery
was performed. No manual visual/audio approval, hosted CI-cost acceptance, or
controlled CPU/rendering performance claim is made. The overall benchmark
migration remains incomplete until Linux entry-point execution and cleanup pass.
Later-ticket retirement gates are not waived. Current commands and policy belong in the [benchmark guide](../../benchmarks/README.md)
and [resource procedure](../../tooling/suites/benchmarks/content/README.md).
