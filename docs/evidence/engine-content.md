# Engine resource workload evidence

Recorded 2026-09-24 on Windows 11, Node 24.15.0 and Chrome 153.0.8010.53.
This is historical evidence for the recorded source hashes and package, not
validation of later changes or a controlled performance baseline.

Two consecutive full standalone runs passed in an engine-only source copy with
no consumer checkout, embedded game fixture or old consumer harness. The copy
shared the existing declared toolchain installation through a dependency junction;
each run freshly built, packed and installed the engine itself. There was no
manual cleanup between runs. Both packages had SHA-256
`8b30acf49ef14137c69003f02313eadaec49872fe1c09fcff149880ef8b38346`.

| Run             | Measured transitions | Cancellation trials | Terminal disposals | Outcome                  |
| --------------- | -------------------- | ------------------- | ------------------ | ------------------------ |
| `independent-4` | 360                  | 9                   | 3                  | Accepted; cleanup passed |
| `independent-5` | 360                  | 9                   | 3                  | Accepted; cleanup passed |

Each run had three repetitions at root, nested and root bases, with twelve warmup
transitions before each repetition. Measurements used headless non-fallback Intel
gen-12lp, a 1280x900 viewport and DPR 1. The browser reported visible documents;
headless execution is still capability evidence, not a visible physical-GPU
performance baseline. No thresholds were transplanted from consumer workloads.

The [machine record](engine-content.json) and [raw archive](engine-content-raw.json.gz)
retain run/package/harness identities, preparation, builds, authored workload,
raw samples, cancellation and disposal counters, cleanup and selection provenance.
Every artifact hash and size was verified, as was archive decoding. The archive
contains original bytes as base64 with per-entry hashes. Disposable installations
remain local; the archive is not a resumable preparation directory.

The current parser independently revalidated all retained samples after adding
safe-integer rejection for closed-image counters. The machine record distinguishes
that parser hash from the original execution harness; the browser workload did not
change. Regression coverage rejects NaN counters, truncated/reordered samples,
fallback adapters, hidden documents, ownership leaks and reused output.

The same fresh package passed generic consumer conformance at the already
authorized clean revision `c04cf1d013a57773a59a601ff0994f5e6bee1864` using the unchanged
consumer-contract-v1 validator. Existing installed-engine browser verification also
passed, with 40 observations at each root/nested base. These acceptance checks used
headless SwiftShader and remain distinct from the resource measurements. The full
NGNE suite passed **262 tests**, with none failed, skipped or cancelled.

Earlier development failures are preserved in the archive: an observer overload
type error, missing explicit audio unlock, and sampling before the destination's
first audio-playing frame. The fixture now uses the public unlock operation and
waits for ordinary destination rendering/audio before sampling. Every failed run
retained its original failure and passed owned-resource cleanup. These were
fixture defects; no engine source or public contract changed.

The workload replaces the resource accounting, platform observation and generated
churn methods described in the [coverage correspondence](../../plans/tooling/engine-content-coverage.md).
It does not establish timing equivalence to the old game workload. Retirement is
not approved: 21 mixed browser assertions still need exact replacement
correspondence or added engine coverage, the content cleanup regression needs a
named retained owner, and legacy commands/default CI still have live references.
The frozen obligations and all retirement gates remain intact. Controlled
comparison modes, named environment profiles, budgets, Linux/hosted execution and
final consumer-independent default verification remain outstanding.
