# Installed content measurements

Build the sibling consumer first, then run from the engine root:

```powershell
npm.cmd --prefix ../ngne-town-dungeon run build
npm.cmd run bench:content
```

The runner uses `../ngne-town-dungeon` by default; pass `--consumer <directory>`
to select another checkout. `--explore` records one shorter diagnostic trial that
cannot satisfy acceptance. Chrome must remain visible. A fresh profile is used
for each repetition. The runner owns and closes only its own browser processes.

`policy.json` fixes acceptance before final execution. Three repetitions each
use the browser/OS/acquired GPU fixed in `environment.json`. Other environments
must first use `--explore` and define their own comparable acceptance baseline.
The window-occlusion flag preserves normal frame scheduling when another window
overlaps Chrome; hidden document states still fail acceptance. Three repetitions
measure 100 Town/Dungeon round trips after five warmup trips, then 120 visits to
twelve distinct rooms after one full warmup window. Each generated room has a
different 24x8 RGBA environment and a different one-second, mono 22050 Hz PCM
tone (decoded at the browser audio context rate). Player content is shared.
Each room owns four scene claims; two image leases belong to the renderer.
The four protected loaded identities exceed the three-entry policy. Departed
content must be reclaimed, leaving no unleased entry after automatic trim.
The twelve-room set exceeds both identity and aggregate decoded-byte budgets.

The production JS/CSS is copied unchanged. Churn changes only external JSON,
PNG and WAV in the copied artifact. Both stage manifests and all payload hashes
are retained. The normal consumer source and build are never modified. The
same built consumer UI and installed public package execute both workloads.

Latency runs from the Travel click until the destination label changes in the
consumer's after-frame callback. It includes fetch, decode, preparation and
activation, but does not claim display scanout or GPU completion timing. The
120 ms drain occurs outside timing. No synthetic clock or forced GC occurs
inside a timed transition. P95 <= 500 ms and maximum <= 2000 ms are local small
content responsiveness gates, allowing substantial scheduling/decode variance;
they are not universal engine performance targets.

Every ten trips/visits, and before/after each measurement window, collect public
resource diagnostics and a forced-GC V8 heap sample. Retained heap final-minus-
initial must be <= 8 MiB and least-squares slope <= 64 KiB per transition.
These are coarse drift alarms that tolerate JIT/DOM/browser noise for a bounded
identity set, independently of exact resource ownership. They do not prove the
absence of all leaks. Process memory is not measured; it must never be inferred
from decoded, texture or V8 estimates. Renderer source estimates overlap CPU
decoded estimates. Texture estimates exclude buffers, driver allocations and
other browser resources. Unknown-size definition snapshots remain explicit.

Browser hooks count live audio sources and bitmap closes without retaining the
objects. Voice counts mean started sources without an explicit stop or ended
event; checkpoints follow the drain interval. Closed audio contexts are counted
separately, since closing a context need not deliver source ended events.
Cancel trials gate one decoded bitmap completion while the mounted
room remains alive, cancel through the UI, then release the late completion.
These controlled trials are outside latency samples. Exact assertions live in
`tests/content-accounting.mjs` and deterministic regressions in
`tests/content-churn.test.ts`; measurement orchestration stays here. Disposal
uses the consumer's pagehide lifecycle and requires zero decoded claims,
bitmap objects, voices and renderer resources in the retained diagnostics.

Artifacts under `.test-output/content/<timestamp>/` include the frozen policy,
source/package/build identities, generated content, all transition/checkpoint
samples, failed trials, browser logs and summary. Do not compact failed runs.
Comparisons require identical policy, browser, OS, acquired GPU, viewport,
visibility, seed and content/package/build identities; mismatches are
`CHECK COMPARABILITY`, never performance improvements or regressions.
`node benchmarks/content/compare.mjs <run> <run>` performs this check.

Visible physical-GPU runs, controlled cancellation, V8 heap and deterministic
tests are separate evidence classes. This procedure does not certify other
devices, software WebGPU, background tabs or spontaneous driver reset.
