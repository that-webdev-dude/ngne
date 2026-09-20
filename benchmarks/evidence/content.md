# Installed content evidence

Accepted local run: 2026-09-20, 2026-09-20T21-34-23.003Z. All six workload windows passed.
Reproduce using [the procedure](../content/README.md) and frozen
[policy](../content/policy.json) / [environment](../content/environment.json).

| Repetition | Workload                 | P50 ms | P95 ms | Max ms | Retained heap growth KiB | Heap slope KiB/transition |
| ---------- | ------------------------ | -----: | -----: | -----: | -----------------------: | ------------------------: |
| 1          | 100 round trips          |   40.2 |   57.1 |   74.0 |                    253.3 |                      1.12 |
| 1          | 120 distinct-room visits |   36.4 |   44.0 |   56.2 |                    172.7 |                      1.40 |
| 2          | 100 round trips          |   39.4 |   55.9 |   60.0 |                    233.2 |                      1.07 |
| 2          | 120 distinct-room visits |   27.7 |   42.0 |   60.5 |                    181.2 |                      1.63 |
| 3          | 100 round trips          |   38.3 |   54.6 |   60.7 |                    224.3 |                      1.09 |
| 3          | 120 distinct-room visits |   30.2 |   42.4 |  129.8 |                    172.6 |                      1.45 |

Budgets fixed before acceptance: P95 <= 500 ms, maximum <= 2000 ms,
retained V8 growth <= 8192 KiB, slope <= 64 KiB/transition. Each repetition
used a fresh Chrome process/profile; both workloads have independent warmup
and checkpoints. These are absolute acceptance gates, not an A/B improvement.
The round-trip and churn timings are different workloads and not comparable.

Environment: Chrome 153.0.8010.48, Windows 10.0.26200 x64, acquired non-fallback
Intel gen-12lp GPU, 1280x900 CSS viewport, DPR 1. All sampled documents were
visible with no hidden-state event. Measurement windows contain 600 normal
transitions and 360 distinct-room transitions in total, excluding warmup and
cancellation retries. No fresh human listening judgment is claimed.

## Ownership and size observations

Every measured transition settled to four loaded/leased identities, zero
loading/unleased identities, four scene claims, two renderer claims, zero
external/dependency claims, two renderer sources/consumers, three textures
(including white), zero uploads/replacements, two live bitmaps, one unstopped
voice and one audio context. Cleanup failures were zero. The protected live
set exceeds the three-entry limit; this is reported, not treated as a cache leak.
Exactly one snapshot has unknown decoded size. Automatic policy trim handles
departed content without explicit forced eviction.

Observed estimated decoded totals span 181264–428224 bytes.
Shared player RGBA is 4096 bytes; each environment is 768 bytes. Renderer
source estimate is 4864 bytes and texture estimate is 4868 bytes. Source bytes
overlap decoded image bytes. Twelve distinct environment/audio payloads total
2126016 decoded bytes excluding shared content, over the 1048576-byte policy.
The same twelve identities cycle through ten measured eviction windows per
repetition; bitmap decode counters prove reloading on revisit.

Eighteen controlled cancellation trials (three per workload/repetition) held
a decoded completion, cancelled preparation while the mounted room survived,
then released the late bitmap. Exact survivor counts and one late close passed
before successful retry. All six terminal disposals left zero decoded entries,
claims, renderer sources/consumers/textures/uploads, live bitmaps, unstopped
voices and open audio contexts. Deterministic tests separately cover 120 visits,
twelve delayed cancellations, exact disposal counts and rejected comparisons.

## Artifacts and provenance

- [Machine-readable summary](content.json): identities, metrics, disposal samples,
  preliminary run dispositions and correctness-oracle hash.
- [Compressed raw evidence](content-raw.json.gz): JSON object mapping original
  filenames to their complete text, including samples, checkpoints, cancellation
  states, policy, manifest, fixture hashes and browser logs.
- Archive SHA-256: `53f5b6094121c251bf4ed36b62819b85a4cfe41813ba9c0fefa7998bb507370b`.
- Uncompressed artifacts and copied production/churn payloads remain at
  `.test-output/content/2026-09-20T21-34-23.003Z/`.
- Installed `ngne@0.1.0` archive SHA-256:
  `66b04d30fede0d31e97ee076781c9e295682f53318ab5e5ca720f2300c07a9ab`.
- Engine starting revision `cf09692d5ff2c9c1dcfa5696ddc48a6047220e4a`; consumer runtime revision
  `5e33846957a53fe4d62e14559ae01d3737813f4e`. Full built file, installed module and source hashes
  are retained. Consumer changes for this measurement task are documentation only.

## Failed and preliminary trials

All prior directories remain under `.test-output/content/`:

- 21:29:39: exploratory terminal voice assertion failed. The observer counted
  only ended events, which context closure did not deliver. Explicit stop and
  context-close accounting corrected the observer; no runtime change was made.
- 21:30:52: corrected exploratory trial passed; not acceptance.
- 21:32:09: final attempt timed out before initial room activation and collected
  no latency samples. Root cause was not established. Startup diagnostics and
  an occlusion scheduling flag were added before restarting acceptance.
- 21:33:21: exploratory trial passed with per-transition accounting. The exact
  browser/OS/GPU baseline was then fixed for the final run. Budgets never changed.

## Supporting validation

- Engine `npm.cmd test`: 165/165; `npm.cmd run typecheck`, `build` and
  `build:browser`: passed.
- Existing `npm.cmd run test:browser` with visible hardware Intel GPU: 192
  passed, zero failures/skips. This run covers the existing engine/game suite;
  the installed-consumer measurements above run through `bench:content`.
- Consumer `npm.cmd test`: 23/23; strict production build and `check:package`:
  passed (32 modules/declarations and matching package SHA-256).
- Focused deterministic churn and comparison-rejection tests: passed.
  Accepted-run self-comparison: comparable; failed/environment-mismatched
  fixtures: `CHECK COMPARABILITY`.
- Formatting, diff whitespace and local document-link checks: passed.
- Vite's initial sandbox build denial was resolved by an approved build outside
  the sandbox. No engine or consumer runtime source change was required.

## Limits

V8 samples follow forced GC outside timed transitions; process RSS and driver
memory were not measured. Definition interning is outside decoded retention;
this bounded twelve-identity workload cannot establish bounds for indefinitely
new definitions. Instrumentation adds observation overhead. Audio voice counts
are lifecycle accounting, not acoustic measurements. Controlled cancellation
does not simulate driver reset. No new software-WebGPU or other-device result,
optional 1000-cycle soak, publication or deployment is claimed.
