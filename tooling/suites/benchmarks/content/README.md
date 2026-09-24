# Engine resource workload

Run `npm run bench:engine-content -- --explore` from the repository root. It builds
and packs the current engine, verifies the package, installs it offline into an
isolated fixture, checks public declarations and builds root/nested outputs. An
explicit `--manifest <exact preparation manifest>` reuses verified preparation.
`--output` must name a fresh directory. Chrome/Chromium with a non-fallback WebGPU
adapter is required. `NGNE_BROWSER` or `CHROME_BIN` selects the executable.

The fixture imports only the installed public package. It generates thirteen
deterministic 64x64 PNGs and cycles twelve scenes. Each scene leases a shared image,
a changing image, audio and an opaque resource. Retention is three entries and
1 MiB: four leased resources stay protected, while superseded images must close.
Every sample checks asset claims, renderer consumers/uploads/textures and live
platform images, textures, audio contexts and voices. Three controlled aborts per
repetition check late decoded-image disposal without replacing the mounted scene.
Terminal disposal must release all owners and platform resources.

Full execution has three repetitions, each with twelve warmup transitions and 120
measured transitions; bases are root, nested, root. Each repetition uses a fresh
page and host. `--smoke` runs one root repetition with twelve measured transitions.
Timing spans preparation through publication and the destination's ordinary
rendered, audio-playing frame, observed by a 10 ms poll. It includes that scheduling
and polling overhead. Samples retain resource snapshots, latency and available
browser JS heap estimates; reports give p50, p95 and maximum latency. Heap estimates
and resource counters are not process or driver memory measurements.

Choose one measurement mode:

- `--explore`: no environment or budget acceptance claim; `--smoke` is available.
- `--baseline --profile windows-intel-gen12-chrome153`: full measurements under the
  named, observed environment. No budget is applied during baseline collection.
- `--controlled --profile windows-intel-gen12-chrome153 --budget <budget.json>`:
  validate the named environment and the exact workload/harness/toolchain signature,
  then evaluate every repetition's p95 against the supplied measured budget.

Profiles in `tooling/profiles/environments/` require exact observed Node, OS, CPU,
memory, browser version/revision/user agent, flags, viewport, DPR and physical
adapter fields. They require headed, visible execution. A missing or changed field
fails acceptance. A profile name alone never establishes matching conditions.
Host power mode and unrelated machine load are not observable through this harness;
keep them stable and disclose interference in the measurement record.

Create a budget from at least three independent full baseline runs using
`node --import tsx tooling/commands/benchmark-budget.ts <new-budget.json>
<profile.json> <run1/evidence> <run2/evidence> <run3/evidence>`.
The command validates inventories, complete raw measurements, cleanup, matching
profiles and workload/harness/toolchain identities. The latency ceiling is 1.2
times the largest repetition p95 across all supplied runs. This is a conservative
local guard with explicit 20% headroom, not a statistical significance test or a
universal engine target. Retain all attempts; do not select only fast baselines.
Budgets retain source run IDs and manifest/result hashes. Retain those evidence
trees with the budget. Changed harness/workload/method requires new measurements.
No historical consumer timing or heap threshold is transferred.

Above-budget repetitions still finish all prescribed samples and subsequent
repetitions. Correctness, budget and cleanup outcomes remain separate; budget
failure makes acceptance unsuccessful. These modes collect baseline evidence and
evaluate budgets; strict/candidate run comparison remains separately owned.
Headed execution is the default. `NGNE_BROWSER_HEADLESS=1` is an explicit capability
mode and is recorded; headless data is not a visible physical-GPU baseline.
Hidden documents and fallback adapters fail even exploratory measurements.

Shared run/session owners preserve diagnostics and require process/server/profile
cleanup before acceptance. Partial samples, ownership failures, changed package,
installation or build identities, and cleanup failures fail the run. Each output
retains package/builds, identities, toolchain, browser flags/version, GPU, viewport,
visibility history, raw samples, cancellation snapshots and disposal counters.
Generated authored inputs and installed/build outputs have separate identities.
Nothing here selects or fetches a consumer checkout or game snapshot.
