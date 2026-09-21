# Runner cleanup validation

Recorded 2026-09-21 on Windows 11 build 26200, Node 24.15.0 and visible
Chrome 153 with non-fallback Intel `gen-12lp`. Base revision:
`bb1a93309f8be9e24b757126ae185686faf00bf3`; the accompanying
[machine-readable record](runner-cleanup.json) identifies the changed tooling by
SHA-256. This is historical execution evidence, not a runtime contract.

| Check                                               | Result                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Deterministic suite                                 | 185 passed; no failures or skips                                                                 |
| Production and browser builds                       | Passed                                                                                           |
| Changed-file formatting and diff whitespace         | Passed                                                                                           |
| Physical browser suite                              | 192 assertions passed; cleanup verified                                                          |
| Installed-content browser suite                     | 238 assertions passed; cleanup verified                                                          |
| Intentional assertion failure                       | Exit 1; original failure and screenshot retained; cleanup passed                                 |
| Assertion plus screenshot failure                   | Exit 1; both failures retained; cleanup passed                                                   |
| Successful validation plus injected cleanup failure | 192 assertions passed; overall failed, exit 1; actual resources released                         |
| Browser startup failure                             | Exit 1; missing executable identified; preview/profile cleanup passed                            |
| Content startup failure                             | Exit 1; missing executable identified; profile/server cleanup passed                             |
| Exploratory content workloads                       | 20 transitions per workload, six cancellation trials, two terminal disposals; all cleanup passed |
| Comparison guards                                   | Changed tooling and cleanup-failed fixtures rejected; real exploratory run rejected with exit 2  |
| Hosted Linux browser workflow                       | Pending execution                                                                                |

The process fixture verified parent and child exit while an unrelated process
remained alive. Real browser and preview shutdown exercised Windows taskkill
escalation and verified no captured owned identities survived. Profiles were
removed; the content HTTP server and the installed-check preview also closed.
Deterministic fixtures cover request correlation, deadlines, late replies,
disconnect, repeated close, failed diagnostics, multiple cleanup failures and
continuation after installed-content restoration failure.

The first cleanup-failure browser attempt exposed an iframe disappearing between
readiness and click. That failed artifact remains recorded as `cleanup`; the
corrected click and successful-validation rerun are recorded as `cleanup-final`.
No failed attempt was relabelled as passing.

Raw local artifacts remain under `.test-output/browser-owner-*` and the content
directories recorded in the JSON. The full formatting command reported eight
pre-existing untracked `.agents/skills/codebase/` files; none was modified or
included in this change. Initial sandboxed process inspection and esbuild attempts
were denied; the required checks passed with host access.

The exploratory benchmark is functional evidence only. No new performance
acceptance, other GPU/browser support, manual audible-output approval, spontaneous
driver-loss proof or Linux result is inferred from these Windows runs. Engine APIs,
contracts, package exports and historical content-performance evidence are unchanged.
