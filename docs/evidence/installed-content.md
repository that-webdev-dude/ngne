# Installed content acceptance

## Evidence matrix

The engine runtime and consumer runtime were unchanged during this acceptance.
The final package was rebuilt and installed into a fresh consumer, without source
aliases, workspace links, engine-only types or consumer test hooks. The machine
manifest alongside this report owns exact package, source, fixture and build hashes.

| Gate                        | Result                    | Evidence and limits                                                                                              |
| --------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Engine correctness          | Passed                    | 165 tests; typecheck, production/declaration build and browser build                                             |
| Clean installed consumer    | Passed                    | 23 tests, strict root/nested builds, runtime import and 32-module/declaration closure check                      |
| Physical GPU, root          | Passed                    | 231 browser assertions, zero failures/skips; acquired Intel gen-12lp, non-fallback                               |
| Physical GPU, nested base   | Passed                    | 231 assertions, zero failures/skips at `/town-dungeon/`                                                          |
| Local software WebGPU       | Passed                    | 231 assertions; SwiftShader; physical-device evidence explicitly unsupported                                     |
| Hosted software WebGPU      | Unverified                | Workflow now includes the pinned installed consumer at both bases; no hosted execution of this change yet        |
| Manual gameplay/audio       | Passed                    | User confirmed movement, both tracks, travel both ways, pause/resume and switching away/back on the root preview |
| Transition/churn accounting | Applicable prior evidence | Final production JS/content match the measured artifact; see equivalence below                                   |

Acceptance remains incomplete while the hosted gate is unverified. No source
inspection or locally executed software run substitutes for that result.

## Device and browser scope

Local runs used Windows 10.0.26200 x64 and Chrome 153.0.8010.48. Device records
identify adapters actually used for queue submission and canvas configuration,
including replacement devices. Controlled `GPUDevice.destroy()` overlapped shared
content use, preparation/cancellation and retention. Assertions verified surviving
ownership, destination rendering, distinct environment pixels, re-upload and
terminal cleanup. This is controlled loss on a physical Intel device, not a
spontaneous driver reset or a claim about every GPU/browser combination.

The integration harness controls frame delivery and emulates focus. Its audio
analyser confirms nonzero signal, not human audibility. The user's separate normal
preview check supplies controls, listening and ordinary tab-switching evidence.
The preview was `http://127.0.0.1:4297/`; nested automation used port 4298.

## Artifact and measurement equivalence

The consumer snapshot is revision `f3584d9c4a2464d7c7c917c8dda934a7cc72f071`.
The engine baseline is `b30f02c6b7713362059a477e4ecf9ea93ab8b0da`; the recorded
working-tree changes add validation tooling, CI wiring and evidence only.
The adjacent machine manifest records the final tarball digest and every installed
runtime/declaration, source, production file and external fixture identity.

The freshly rebuilt package's runtime modules/declarations match the package used
for the [accepted transition/churn measurements](../../benchmarks/evidence/content.md).
Package metadata/documentation changes alter the tarball hash without changing the
consumer production build. Root build and content hashes remain identical to that
measurement manifest; nested build identity is recorded separately. Consequently
the three 100-round-trip and 120-distinct-visit repetitions remain applicable.
The original raw archive and frozen budgets remain authoritative; this is an
equivalence check, not a fresh measurement or a performance improvement claim.

Definition interning is outside decoded retention. Bounded twelve-identity churn
does not prove bounded arbitrary URL discovery. CPU/renderer source estimates
overlap; payload estimates exclude driver allocations. Retained V8 heap is separate
from exact resource accounting; process RSS and a 1,000-cycle soak were not measured.

## Reproduce

Run `npm test`, `npm run typecheck`, `npm run build`, `npm run build:browser`, then
`npm run test:installed`. The [fixture instructions](../../tests/fixtures/README.md)
describe fresh output directories and provenance. Serve the generated consumer:

```powershell
npm --prefix .test-output/installed-content/consumer run preview -- --port 4297 --strictPort
# Separate terminal:
npm --prefix .test-output/installed-content/consumer run preview -- --port 4298 --strictPort --base=/town-dungeon/ --outDir=dist-nested
```

Set `NGNE_BROWSER_HEADLESS=0`, `NGNE_CONSUMER_URL`, `NGNE_CONSUMER_DIST` and a unique
`NGNE_BROWSER_ARTIFACT_DIR`, then run `npm run test:browser` for each base. Hardware
runs can require `NGNE_EXPECT_GPU_VENDOR=intel`. For software runs set
`NGNE_WEBGPU_ADAPTER=swiftshader`; CI additionally uses Linux/Xvfb. Use disposable
builds because failure checks temporarily corrupt and restore built JSON.

`installed-content.json` retains identities and full browser results;
`installed-content-raw.json.gz` retains raw JSON/log evidence. Uncompressed local
builds and logs remain under `.test-output/final-package/` and the clean-install
output named in the manifest. Initial sandbox npm-cache/esbuild failures and occupied
preview ports were environmental setup failures; retries used normal filesystem
access and fresh ports. They are not reported as runtime passes.

## Documentation ownership

Reviewed architecture, public export inventory, simulation, browser/presentation,
ownership/inspection, guide and consumer README against the implemented pipeline.
No runtime contract change was needed. Architecture owns the lifecycle model;
contracts own preparation, recovery, leases and retention semantics; the guide owns
engine usage; the consumer README owns schemas, mechanics and authoring. Measurement
methodology and accepted budgets remain under `benchmarks/`. No temporary proposal
or ticket ledger remains in authoritative documentation.
