# Frozen hosted baseline evidence

This directory records deliberate hosted measurements of revision `7d7585ede1aa25147b423f48c9c7f1339678f280`. It does not validate the later tooling implementation or current engine checkout. The [cost record](../ci-cost-baseline.json) owns measured stages, environment, cache state, artifact sizes and the median. The [procedure](../ci-baseline-procedure.md) defines collection and matching.

Each directory is named `<Actions run ID>-<attempt>`. Every attempt is a fresh complete hosted job; retries use the complete-workflow endpoint. API run/job/artifact snapshots retain GitHub's external response schema; they are raw provenance, not NGNE runtime envelopes. Gzip-compressed job logs and those snapshots were collected before advancing the attempt. `retention.json` records retained artifact diagnostics and omissions. Compressed diagnostics preserve their original bytes; hashes and original paths are recorded there.

The first attempt timed out waiting for `window.__contentHarness.deviceWaiting === true` during installed-consumer recovery. Browser and orchestration cleanup passed. The unchanged workflow passed on the second attempt, but GitHub assigned a different environment: the failure used image `20260920.314.1`, Node `24.21.0` and Chrome `153.0.8010.52`; the next two successes used image `20260907.300.1`, Node `24.20.0` and Chrome `152.0.7977.82`. A later successful attempt used the newer image too. The cause is not established; this is not proof of a browser-version regression or a same-environment intermittent failure. Keep the failed attempt and its cost visible.

GitHub removes earlier artifacts on full reruns. Attempt 1's ZIP was downloaded for diagnosis. Attempt 2's ZIP was lost before this behavior was discovered; complete Actions logs and API artifact size/digest remain retained, but independent payload inspection is unavailable. Subsequent ZIPs are downloaded and hash-checked before another rerun. Full downloaded ZIPs remain ignored local output; selected result JSON and runner diagnostics are retained here. Generated consumer builds, vendor packages and screenshots are omitted from committed evidence.

Hosted evidence uses Xvfb and SwiftShader software WebGPU. It does not establish physical-GPU behavior or manual audible/visual confirmation. The frozen engine suite reports 179 passed and six platform-specific skips; its installed-consumer deterministic suite reports 65 passed. Those are frozen-workload results, not the current repository test count.

The measurement workflow has no deployment or Pages publication, and its automatic trigger matches only its own file on the existing feature branch. A merge into main does not trigger it. The normal verification/deployment workflow remains unchanged. No merge or deployment was performed.

## Recorded attempts

| Attempt                                                                           | Outcome | Wall seconds (excluding queue) | Artifact bytes |
| --------------------------------------------------------------------------------- | ------- | -----------------------------: | -------------: |
| [1](https://github.com/that-webdev-dude/ngne/actions/runs/35906826416/attempts/1) | failure |                            124 |        1227250 |
| [2](https://github.com/that-webdev-dude/ngne/actions/runs/35906826416/attempts/2) | success |                            125 |        1945828 |
| [3](https://github.com/that-webdev-dude/ngne/actions/runs/35906826416/attempts/3) | success |                            176 |        1968371 |
| [4](https://github.com/that-webdev-dude/ngne/actions/runs/35906826416/attempts/4) | success |                            165 |        1945678 |
| [5](https://github.com/that-webdev-dude/ngne/actions/runs/35906826416/attempts/5) | success |                            161 |        1973126 |
| [6](https://github.com/that-webdev-dude/ngne/actions/runs/35906826416/attempts/6) | success |                            159 |        1973197 |

Five successful measurements: median **161 seconds**. Proposed 20% final budget: **193.2 seconds**, conditional on matched environment and required-coverage mapping. The baseline contains multiple hosted environment versions; match the recorded five-run environment sequence or remeasure the frozen baseline under final conditions. No final implementation cost comparison is claimed.
