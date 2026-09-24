# Consumer integration evidence

Recorded 2026-09-24 on Windows 11, Node 24.15.0, npm 11.12.1 and
Chrome 153.0.8010.53. These are historical results, not acceptance of later changes.

The explicitly supplied checkout was
`C:/Users/jfabi/Documents/Projects/tests/ngne-town-dungeon`. Its owner authorized
the migration and a consumer-only commit. Clean consumer revision
`c04cf1d013a57773a59a601ff0994f5e6bee1864` passed the unchanged generic
`verify:compatibility` runner and its consumer-contract-v1 validator. No push was
performed. NGNE remained on `tooling/t1a-coverage-ownership` at
`9401adb3474d44890d7a2b892beda0cd9b5591d7` with uncommitted tooling changes.

The selected package SHA-256 was
`f5f9534fb090e12655d74cbf612384557a2b9e9d50b542241537a19c60da79d4`.
The exact preparation manifest was
`out/runs/2026-09-24T06-15-01.241Z-package-2c39f92b-2a41-4292-a391-f4c5b3a07f93/evidence/manifest.json`.
The compatibility invocation supplied that manifest, the checkout, its full
revision and fresh output `out/runs/t4-real-consumer-c04cf1d`, with
`NGNE_WEBGPU_ADAPTER=swiftshader` and `NGNE_BROWSER_HEADLESS=1`.

| Check                                       | Recorded result                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NGNE deterministic tests                    | 258 passed; none failed or skipped                                                                                                                           |
| Consumer acceptance                         | 66 tests; 111 browser checks at each of root and nested bases                                                                                                |
| Generic compatibility                       | Accepted; validator identities retained; cleanup passed                                                                                                      |
| Installed engine verification, same package | 40 observations at each base; cleanup passed                                                                                                                 |
| Explicit consumer measurements              | Three repetitions; 600 production transitions, 360 churn visits, 18 cancellation trials and six disposals; complete sampling, all budgets and cleanup passed |
| Tooling checks                              | Typecheck, formatting, migration check and diff whitespace check passed                                                                                      |

Acceptance and measurement are separate consumer commands. Measurements were
direct exploratory development runs before the commit, on headless non-fallback
Intel gen-12lp. Their source and lock inventories exactly match the later clean
consumer acceptance, but their original dirty revision metadata is retained.
Browser acceptance used headless SwiftShader. Neither establishes a matched
performance baseline, Linux/hosted validation or manual visual/audio acceptance.

The [machine record](consumer-integration.json) identifies runs and hashes. The
[raw archive](consumer-integration-raw.json.gz) contains original evidence files
and supporting logs as base64 bytes with SHA-256 and size per entry. Every run's
artifact inventory and the archive round trip were checked. The earlier audit
inside the archive predates commit approval; its pending status is historical.
Disposable installs/builds and the complete preparation directory are not in the
archive; retain the local preparation to rerun its manifest.

Consumer migration and real conformance do not authorize retirement by themselves.
The adopted engine benchmark replacements for `workload:content-accounting`,
`workload:content-browser-observer` and `workload:content-generated-churn` remain
unimplemented. Exact assertion replacement review, migration proof records and
default CI separation remain outstanding. Existing embedded coverage and all
retirement gates were preserved; the migration checker still reports 443 blocked
retirements. See the [coverage map](../../plans/tooling/coverage-map.md).
