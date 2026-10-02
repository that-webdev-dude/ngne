# Sprite and animation previewer implementation plan

Status: complete locally on 2026-10-02. M3, the final scoped UI/ergonomics milestone, passed implementation, documentation, installed verification, explicit human approval and verified cleanup. Earlier accepted evidence remains preserved. All work remains unstaged and uncommitted.

## Instructions for the implementing agent

Read this file, [RULES.md](../RULES.md), [tooling guidance](../tooling/README.md), and the relevant [browser and presentation contract](../docs/contracts/browser-and-presentation.md). Inspect the current checkout and preserve unrelated work.

The milestone 1 stop point below is historical and has been passed. Complete the authorized remaining scope without repeating its accepted human checks. Choose routine internal details directly; report concrete blockers and the smallest alternative.

Keep this as the single implementation plan, including progress and evidence references. Do not create parallel requirements, design, validation or handoff documents. This file does not itself authorize execution, commits, pushes, publication, issue mutations or changes to another repository. Later user instructions control authorization.

## Goal and exclusions

Provide consumer-accessible development tooling to inspect sprites and animations through the installed NGNE renderer. The [engine development report](../ENGINE-DEVELOPMENT-REPORT.md#provide-reusable-presentation-and-asset-preview-support) records the motivation: valid artwork can still lose detail or have unreadable motion at intended size. Human judgment approves artwork; the tool supplies faithful inspection and input diagnostics.

The workflow is artwork -> sprite/animation inspection -> human review -> level authoring -> contextual runtime review. LDtk remains the planned level-authoring facility. Isolated inspection cannot establish readability against game backgrounds, lighting, HUD, camera movement or other entities. Composite/runtime preview and a consumer scene hook belong to later work.

Excluded: sprite editing, atlas packing, animation authoring, rich timelines, onion skinning, asset/project management, level editing, LDtk import, gameplay simulation or animation state machines, new rendering backends, a shared editor framework, universal exporter support, live reload and benchmarks.

Deepwell supplies external adoption evidence, not engine requirements. Its schemas, frame names, dimensions, density and game rules remain consumer-owned. Its accepted R4 is not reopened.

## Baseline and affected surfaces

Original inspection: 2026-10-01 at revision `856184412c53e8b8723c2db3177469fa149e7079`. Recheck before implementation; this is historical context.

- [package.json](../package.json) declares NGNE 0.1.0, `private: true`, one root export, no executable and no preview subpath. Its `preview` script is Vite's production preview; preserve that meaning.
- The package includes `dist/engine`, the guide and contracts. [tsconfig.lib.json](../tsconfig.lib.json) emits only `src/`. [Package preparation](../tooling/core/package.ts) builds the engine and verifies packed bytes; the preview tool needs explicit build and package inclusion.
- Public [Frame/Sprite](../src/renderer.ts), [WebGPURenderer](../src/webgpu-renderer.ts), [Camera](../src/primitives.ts) and [image assets](../src/assets.ts) provide the required facilities. No runtime API changes are expected.
- Browser rendering requires WebGPU and a secure origin. The loopback host uses this existing path, without a fallback backend.
- Package tooling rejects runtime, optional and peer dependencies without a policy update. Repository Vite/tsx installations are not consumer dependencies.

Expected work: preview source under `tooling/`, a checked build target, package executable/allowlist/build integration, and focused tooling tests/fixtures. Keep tests under `tooling/tests/`; `tests/` remains engine-owned. Keep CLI, UI and adapter loading outside the root runtime import graph.

## Provisional decisions

These record the original design and milestone boundaries. Current supported usage and input semantics are owned by the [engine guide](../docs/guide.md#sprite-and-animation-inspection); the evidence below records delivery against this plan.

### Command and host

- Ship one executable, provisionally `ngne-preview`, in the NGNE package. Defer public types subpaths and an embeddable host API.
- Consumer invocation is an npm script, for example `"preview:assets": "ngne-preview ./preview.config.mjs"`. Use the installed command without silently downloading a tool/renderer.
- Use Node built-ins for a self-contained loopback server and native browser controls. No new installed dependencies, companion package or consumer dev-server integration.
- Print the actual URL. Startup/config failures appear in the terminal; image decode/upload and WebGPU failures remain visible in the page. Never report a failed blank preview as success.
- Serve only packaged tool files, installed engine modules and registered images. Do not expose an arbitrary filesystem root.
- Ctrl+C closes the server; browser teardown cancels playback and releases rendering resources. Reload/restart is sufficient; no watchers or automatic browser launch.

### Adapter and paths

- Load one explicitly selected `.mjs` adapter in Node. Its default export is normalized data; module code may read and translate existing consumer metadata. The browser receives data, not executable adapter code.
- Resolve the config argument from the invocation directory. Its imports follow normal Node ESM rules, without aliases or hidden transpilation.
- Images use local file URLs, such as `new URL("./assets/atlas.png", import.meta.url)`. The server maps registered files to browser HTTP URLs.
- Consumer exporter dependencies remain consumer-owned. Direct TypeScript loading, a second JSON-config entry format and remote images are deferred.
- Validate normalized input in the tool. Source-schema validation and translation accuracy remain consumer responsibilities. Do not duplicate Deepwell's manifest by hand or build its schema into NGNE.

### Renderer and display

- Use public `WebGPURenderer`, `Frame`, `Camera` and existing image-loading behavior. Preserve decoding, texture upload, alpha and shaders. No Canvas 2D/CSS rendering replacement, private-method patches or game simulation.
- Resolve the browser engine import to the same installation that supplies the executable. Do not bundle an alternate renderer into the UI or use a global/latest engine. Internal module requests can follow the public entry's imports; consumers need no private imports.
- Frames declare source rectangles in image pixels and destination dimensions in consumer logical units.
- Display configuration declares render pixels per logical unit, CSS pixels per render pixel, and pixel snapping. Convert destination sizes to canvas pixels once; apply CSS presentation separately.
- Center frames on one fixed stage position. Keep stage dimensions stable across the sequence and sufficient for its frames. Do not auto-fit each frame or recenter using opaque-pixel bounds. Custom origins/offsets are deferred.
- Milestone 1 fixes inspection zoom at 1. Label source/destination size, density, presentation scale and measured canvas/CSS bounds and DPR. Do not silently shrink to fit the panel.
- Do not automatically multiply backing dimensions by DPR and change the declared rendering. Record browser zoom as a controlled/manual setting; DPR alone does not identify it independently.
- Later magnification enlarges the baseline rendered output, without enlarging sprite destination dimensions or changing timing. It must not restore source detail that intended-size rendering discarded.

### Normalized data

Choose property names during implementation; use one small internal input type.

| Input      | Required meaning                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Images     | Unique IDs and local file references; decoded dimensions are authoritative                                                                  |
| Frames     | Unique IDs, image reference, nonnegative integer source x/y, positive integer source width/height, positive finite destination width/height |
| Animations | Unique IDs, nonempty ordered entries referencing frames, positive finite milliseconds per entry                                             |
| Playback   | Explicit `loop` or `once` per animation                                                                                                     |
| Display    | Positive finite render density and CSS presentation scale; pixel-snap setting                                                               |

Frames may exist without animations. Repeated frame references are valid, distinct sequence entries. Validate container shapes, identities, references, source bounds, derived dimensions and finite total duration before presenting input as usable. Do not clamp rectangles, guess timings or skip invalid entries. Errors identify the image/frame/animation and field or sequence entry.

### Playback

Use an elapsed-time calculation with a controlled clock in tests. Browser callback counts must not determine playback speed.

| Action                  | Behavior                                                               |
| ----------------------- | ---------------------------------------------------------------------- |
| Select animation        | First entry, paused, elapsed time zero                                 |
| Play                    | Advance by elapsed visible playback time                               |
| Pause/resume            | Preserve and continue entry and elapsed time within it                 |
| Loop boundary           | Return to entry zero at total duration, retaining the time remainder   |
| Once completes          | Hold last entry and stop; Play restarts from the beginning             |
| Tab hidden              | Pause, exclude hidden elapsed time, require explicit Play after return |
| Select standalone frame | Stop playback and display that frame                                   |

Intervals are start-inclusive/end-exclusive. For `A/80 ms, B/120 ms, A/200 ms`, entries change at 80 and 200 ms; at 400 ms the sequence loops or completes. Keep repeated entries separately identifiable. Do not promise each short entry receives a physical display refresh.

Later stepping: while paused, Previous/Next moves one entry, clamps at either end even for loops, and resets that entry's elapsed time. Resume gives it its full duration. Do not implement stepping in milestone 1.

## Milestone 1: installed preview slice

Implement only this path:

```text
Identified NGNE tarball -> independent installation -> installed command
  -> consumer adapter -> select frame/animation -> intended-size rendering + play/pause
```

1. Implement the minimal host, validation and browser page. Use accessible native frame/animation selectors and play/pause, with current entry/duration and display labels. No UI framework or polished layout.
2. Build and package all executable/browser assets. Extend existing package checks to require them. The installed tool must run without consumer Vite, tsx or engine checkout access.
3. Add a generic fixture with asymmetric crops, different sizes, partial transparency, unequal durations, repeated entries and a standalone frame. Its names and dimensions must differ from Deepwell.
4. Prepare one exact tarball, install it in an isolated consumer directory and launch its executable. Reuse existing verification/evidence machinery; do not build another compatibility framework.
5. Exercise an external adapter against Deepwell's existing metadata/images in an isolated review installation. Do not modify Deepwell's checkout, vendor package, lockfile or saves. Keep its adapter in the isolated consumer; ordinary NGNE tests must run without sibling checkouts.

The sibling consumer is `../ngne-deepwell`. Inspect `src/assets/atlas.ts`, `src/assets/atlas.json`, `plans/R4.md` and `evidence/r4-final/README.md` before translation. Convert uniform timings into per-entry milliseconds. State-selected poses are not gameplay loops; label any inspection-only sequences accordingly. Read the selected data without copying game rules into the tool.

If that checkout is unavailable, finish generic/package work and report external proof pending. Do not invent consumer or human results.

### Milestone 1 acceptance

| Requirement        | Focused proof                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Installed delivery | Fresh consumer launches the packaged command with adapter/images, without copied tool code, source aliases, workspace links or engine checkout access                                                                          |
| Package fidelity   | Record tarball hash/version and verify served engine modules against the installed package inventory; a version label alone is insufficient                                                                                    |
| Runtime separation | A normal consumer importing `ngne` builds without preview UI or Node host modules in its dependency graph                                                                                                                      |
| Drawing and size   | Browser evidence distinguishes crop, destination size, centered alignment and partial transparency, with the declared CSS mapping and no silent fitting                                                                        |
| Playback           | Controlled-clock checks cover unequal timings, exact boundaries, repeated entries, pause/resume, once/loop endings and no hidden-time catch-up; browser review confirms visible playback/visibility behavior                   |
| Diagnostics        | Focused cases cover malformed input, ambiguous IDs, missing references, empty sequences, invalid/out-of-bounds rectangles, invalid/overflowing dimensions or timing, image-load failure and visible renderer failure reporting |
| External adoption  | A small adapter reads Deepwell's existing metadata; record integration effort, limitations and whether intended-size motion is inspectable                                                                                     |
| Shutdown           | Stop owned servers/processes, release browser resources and preserve failure evidence                                                                                                                                          |

Run focused tests, relevant tooling/build typechecks and installed/browser checks using existing runners. On Windows use `npm.cmd`. Broaden checks when shared build changes warrant it; no benchmarks or unrelated campaigns. Failed stages and cleanup failures remain failures.

Record package/consumer revisions or file hashes for uncommitted inputs, fixture, commands, browser/OS/GPU, viewport, canvas/CSS dimensions, DPR and controlled browser zoom. Separate deterministic results, browser observations and human judgment. Software WebGPU does not establish physical-device appearance; screenshots alone do not establish animation readability.

### Review point

Stop after milestone 1. Report:

- Changed files, installed launch command, exact adapter/example and package identity.
- Checks and evidence paths, failures and untested limits.
- Whether external launch works, the adapter is small, and size/timing can be inspected.
- Any decision invalidated in practice and the smallest adjustment.
- The human review still required; do not claim unreceived approval.

The user reviews the slice before authorizing later work. If browser/human review is unavailable, retain the implementation and report pending evidence instead of claiming full verification. Rejecting an artwork is not a tool failure, and Deepwell release acceptance remains closed.

## Later full-feature completion

These remain full-feature requirements, but are not milestone 1 work:

- Previous/Next controls and deterministic stepping checks with the defined boundaries.
- Labelled magnification and a readily accessible baseline size. Test detail lost at intended render size: zoom must enlarge that result, not rerender the source larger.
- Human review of external frames and motion at intended size and magnified, with observations and approve/revise decisions separate from metadata validity.
- Supported usage/input documentation and final installed-surface checks.

Reconsider custom origins only if actual fixtures show an alignment need; a public types subpath only if it materially improves adapter authoring. Live reload, TypeScript execution, polished UI and composite scenes remain excluded unless separately selected.

Full-feature acceptance includes milestone 1 evidence and these later requirements. A passed slice proves feasibility, not completion or contextual art/gameplay quality.

## Documentation and progress

### M3: final inspection ergonomics — 2026-10-02

Authorized scope: evaluate the rectangular stage and margins; implement a viewport
bounded by the window, deliberate panning, retained inspection position across
1×/2×/4×/8× magnification, and one-click centered baseline restoration. Preserve
backing dimensions, density, fixed frame alignment, pixel magnification and playback.
Keep controls accessible and every canvas edge reachable. Update supported usage,
add focused interaction regressions, and verify isolated generic/external installs
against one exact tarball. Finish with actual human observations and approve/revise
decision for external frames/motion, then verified shutdown. No later milestone.

Evaluation: the external 482×130 canvas comes from the maximum dimensions across
the adapter's frames. Cropping or fitting per selection would change accepted
geometry/alignment. Keep that canvas and center it inside a flexible clipped
viewport; separate the viewport background from its checkerboard. Move rendering
details into an expandable panel. Pan by captured pointer drag, wheel/Shift-wheel,
or focused arrow keys; retain the baseline-space canvas point at viewport center
through zoom and resize. Clamp panning with each canvas edge reachable at center.
Baseline resets both magnification and position. No runtime/public API changes.

Implementation, automated verification, human acceptance and cleanup passed.
Earlier evidence and failed attempts below remain historical and unchanged.

**Changes/checks.** `tooling/preview/{browser.ts,index.html,inspection.ts}` implements
the bounded viewport and presentation-only pan state. Host/package inventories
include the new internal module. The guide owns supported interactions; tooling
guidance identifies browser coverage. Focused preview/preparation tests: 52 passed.
Tooling/preview typechecks, affected-file Prettier and `git diff --check` passed.
No runtime/public API, consumer checkout, vendor, lockfile or save changes.

**Exact candidate.** `ngne@0.1.0`, base revision
`856184412c53e8b8723c2db3177469fa149e7079` plus uncommitted inputs identified by the
[preparation manifest](../out/preview-m3-package/evidence/manifest.json).
[Tarball](../out/preview-m3-package/evidence/package/ngne-0.1.0.tgz) SHA-256:
`48c20d49d799d2d62ef79c1ad1dcc08235a460faf9bba78be02f2a396f85180a`.
Preparation and `check:prepared` passed; all following checks reuse this manifest.

| Evidence                                                                                                                                                         | Result                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Generic installed preview](../out/runs/2026-10-02T06-18-24.683Z-preview-755bf70e-7a7b-45d8-8315-e4a3e7bc7665/evidence/result.json)                              | Passed CSS/backing geometry, stepping/playback/diagnostics, panning and zoom retention, baseline, disposal, integrity and cleanup.                                                                                                              |
| [Viewport interactions](../out/runs/2026-10-02T06-18-24.683Z-preview-755bf70e-7a7b-45d8-8315-e4a3e7bc7665/evidence/stages/inspection-viewport/observations.json) | Real browser mouse drag/capture and release outside viewport, wheel and focused keyboard pan, edge reachability and center retention across zoom. No page overflow and controls visible at 640×640, 390×640 and 1280×720 with 8× magnification. |
| [Lost-detail pixels](../out/runs/2026-10-02T06-18-24.683Z-preview-755bf70e-7a7b-45d8-8315-e4a3e7bc7665/evidence/stages/detail-loss/observations.json)            | Every 4× screenshot pixel replicates baseline; discarded green source stripes remain discarded.                                                                                                                                                 |
| [External installed preview](../out/runs/2026-10-02T06-19-40.800Z-preview-c5af67a1-7199-4cab-a430-33b745f8f6ac/evidence/result.json)                             | Same interaction checks passed on a fresh installation using the previously identified external snapshot; original snapshot and installed bytes unchanged, process cleanup passed.                                                              |
| [Installed engine](../out/runs/2026-10-02T06-19-40.877Z-installed-c7be8f7d-6694-44b9-aa69-c0c05d11f309/evidence/result.json)                                     | Root/nested installed-engine checks and cleanup passed against the same preparation.                                                                                                                                                            |

Commands: `prepare:package -- --output out/preview-m3-package`, then
`check:prepared`, `verify:preview`, external `verify:preview --fixture out/preview-m1-deepwell`
and `verify:installed`, each with `--manifest out/preview-m3-package/evidence/manifest.json`.
All invoked through `npm.cmd run`; installed-engine verification used
`NGNE_WEBGPU_ADAPTER=swiftshader`.

Automated environment: Windows `10.0.26200` x64, Node `24.15.0`, Chrome
`154.0.8037.58`, headless SwiftShader; initial viewport 1082×698, DPR 1,
fresh-profile 100% browser zoom/page scale 1. Generic backing 20×24, baseline CSS
40×48; external backing/baseline CSS 482×130. No failed M3 verification runs.
Windows graceful termination attempts sometimes required the existing forced
fallback; final process-tree checks found no survivors. Historical failures stay
retained below. No physical GPU, touch/pen, other browser/DPR or contextual
gameplay coverage is claimed. Canvas placement rounds to CSS pixels (at most half
a CSS pixel position error); density, backing and fixed frame geometry do not change.
At very short window heights the control header can scroll internally while the
viewport retains a minimum height; artwork is never silently fitted.

**Human review and closeout — 2026-10-02.** Review used the verified external installation at
`http://127.0.0.1:51684/`, owned PID 22340;
[launch identity](../out/preview-m3-human/evidence/stages/launch/observations.json).
Opened `sub` paused at 4×: renderer ready, backing 482×130, CSS 1928×520, in-app
viewport 1280×720, DPR 1. [Review capture](../out/preview-m3-human/review-start.png).
Requested actual observations for layout/control access, panning, zoom center
retention, centered baseline restoration, and `sub`/`jelly` motion during inspection,
plus explicit approve/revise. User reported: “review done. approved”. This is explicit
approval of the requested M3 review; no separate per-control or per-animation
observations were supplied, so no additional detailed observations are inferred.
Final observed page state: `sub`, entry 3/4 paused, 4×, renderer ready, viewport
651×998, DPR approximately 0.9. Browser zoom 100% was requested but not explicitly
confirmed; DPR alone does not identify zoom.

Closed the owned review tab to release browser resources, then stopped the host
through its existing process owner. [Review-host result](../out/preview-m3-human/evidence/result.json):
integrity and cleanup passed, no failures, runner exited zero; the existing forced
termination fallback was needed and verified no surviving owned processes.
PID 22340 was absent and port 51684 refused connections afterward. All owned
review/verification processes are stopped. No accepted verification checks were
rerun after approval. Physical keyboard Ctrl+C delivery retains its historical
unverified limit. M3 and the scoped previewer are complete locally; no further
milestone is required. All work, including this plan and both root report/proposal
files, remains unstaged and uncommitted. No push, publication, PR or issue mutation.

The user explicitly authorized the remaining implementation and necessary authoritative documentation updates on 2026-10-02. The [engine guide](../docs/guide.md#sprite-and-animation-inspection) owns supported usage/input semantics; [tooling guidance](../tooling/README.md#sprite-inspection) owns verification commands. Current engine contracts remain unchanged.

Once supported documentation is approved and written, link to its owning usage/input contract rather than maintaining competing specifications. Local tarball proof does not require package publication.

- Milestone 1 implementation: complete locally; no staging, commit or publication.
- Milestone 1 verification: deterministic, package and installed/browser checks passed; limits below.
- External launch: passed with an isolated Deepwell metadata/image snapshot; focused human review passed below.
- Review decision: milestone 1 guided checks accepted; later scope authorized.
- Earlier functional scope: implementation, documentation, installed checks, human review and review-host shutdown complete. Its accepted ergonomics limitation is now addressed by M3 above; M3 acceptance is separate.

### Milestone 1 evidence — 2026-10-01

**Changes.** `tooling/preview/` owns the Node host, validation, elapsed-time playback and native browser page. `tooling/fixtures/preview/` owns the generic adapter, asymmetric transparent PNG and reproducible generator. Focused tests are in `tooling/tests/preview.test.ts`; `tooling/tests/preparation.test.ts` also checks preview emission cleanup. `package.json`, `package-lock.json` and `tooling/core/{package,preparation,fixture}.ts` add the executable, checked/package assets, source hashes and runtime graph exclusion. `tooling/commands/verify-preview.ts` and `tooling/suites/verification/preview.ts` reuse the existing Run, package integrity and BrowserSession/process owners. No `src/` or root export changes; the existing `preview` script retains its Vite meaning.

**Exact package.** Base revision `856184412c53e8b8723c2db3177469fa149e7079`, with uncommitted inputs identified by the preparation and browser manifests. `ngne@0.1.0`, [tarball](../out/preview-m1-package/evidence/package/ngne-0.1.0.tgz), SHA-256 `b8f5a9c33602d4710cc5607a3e973d687f6eadd6066a6afb12209c16ad6222ae`. [Preparation manifest](../out/preview-m1-package/evidence/manifest.json) records packed/installed bytes, preview source hashes, toolchain and normal-consumer root/nested builds. Both independent preview installations used this same tarball; served engine JavaScript hashes matched its installed inventory. Their installed npm executable ran with Node filesystem reads restricted to the independent consumer, excluding the engine checkout and consumer Vite/tsx dependencies.

**Checks.** Passed 47 focused preview/preparation tests; all 296 repository tests; `npm.cmd run typecheck:tooling`; `npm.cmd run build`; changed-file Prettier and `git diff --check`. Preparation and both normal-consumer builds passed the runtime graph exclusion check. Commands:

```powershell
npm.cmd run prepare:package -- --output out/preview-m1-package
npm.cmd run check:prepared -- --manifest out/preview-m1-package/evidence/manifest.json
npm.cmd run verify:preview -- --manifest out/preview-m1-package/evidence/manifest.json
npm.cmd run verify:preview -- --manifest out/preview-m1-package/evidence/manifest.json --fixture out/preview-m1-deepwell
```

| Evidence                                                                                                                                                     | Result and scope                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Generic installed run](../out/runs/2026-10-01T20-56-44.942Z-preview-c84c9120-bf0d-4c0b-b7d0-36de2f6dee51/evidence/result.json)                              | Passed drawing/size, standalone selection, unequal/repeated playback, pause/resume, once completion, real tab-hide suspension, visible corrupt-image/bounds/renderer errors, pagehide disposal, SIGINT-handler shutdown and process-tree cleanup. |
| [Deepwell installed run](../out/runs/2026-10-01T20-45-58.181Z-preview-fe738bad-ac54-4c3c-b204-57fa9b4eb829/evidence/result.json)                             | Passed adapter launch, input validation, installed-module fidelity, timed sub animation, pause/visibility and disposal/cleanup. This earlier run predates the later generic diagnostics/explicit SIGINT stage.                                    |
| [Generic browser observations](../out/runs/2026-10-01T20-56-44.942Z-preview-c84c9120-bf0d-4c0b-b7d0-36de2f6dee51/evidence/stages/browser/observations.json)  | Windows `10.0.26200` x64, Node `24.15.0`, Chrome `154.0.8037.58`, headless SwiftShader; actual viewport 1082×698, forced DPR 1, fresh-profile 100% browser zoom/page scale 1. Canvas 20×24, CSS 40×48; density 1, CSS scale 2.                    |
| [Deepwell browser observations](../out/runs/2026-10-01T20-45-58.181Z-preview-fe738bad-ac54-4c3c-b204-57fa9b4eb829/evidence/stages/browser/observations.json) | Same browser/OS/GPU envelope. Fixed canvas/CSS 482×130; density 2, CSS scale 1. Sub crop 48×32 renders at 48×32 from 24×16 logical units.                                                                                                         |

Agent screenshot inspection of [flag](../out/runs/2026-10-01T20-56-44.942Z-preview-c84c9120-bf0d-4c0b-b7d0-36de2f6dee51/evidence/initial.png) and [kite](../out/runs/2026-10-01T20-56-44.942Z-preview-c84c9120-bf0d-4c0b-b7d0-36de2f6dee51/evidence/different-size.png) distinguished asymmetric corner colors/crops, different destination sizes, a shared center and checkerboard visible through partial alpha. [External playing capture](../out/runs/2026-10-01T20-45-58.181Z-preview-fe738bad-ac54-4c3c-b204-57fa9b4eb829/evidence/playing.png) and playback observations show inspectable intended-size selection and timing; screenshots are not human motion/readability approval.

**External adapter and review launch.** The [17-line adapter](../out/preview-m1-deepwell/preview.config.mjs) translates exact atlas JSON/PNG snapshots, including all 126 frames and 12 sequences, without hand-entered rectangles/timings or exporter dependencies. It divides destination sizes by atlas scale and expands uniform timings into entries. Implosion plays once; eel-head is labelled inspection-only state poses. Other state poses remain standalone frames. Original revision `cfbac050cf9668fb4ac2e10912ab445f158960bd`; [source identity](../out/preview-m1-deepwell/source-identity.json) records tracked hashes and pre-existing local changes. Original tracked files, vendor, lockfile and Git status matched afterward. No game launch, save access, checkout edits or R4 acceptance changes.

Run from the NGNE root, then open the printed URL:

```powershell
npm.cmd --prefix out/runs/2026-10-01T20-45-58.181Z-preview-fe738bad-ac54-4c3c-b204-57fa9b4eb829/work/consumer run preview:assets
```

The generic example is [preview.config.mjs](../tooling/fixtures/preview/preview.config.mjs). Its review installation is `out/runs/2026-10-01T20-56-44.942Z-preview-c84c9120-bf0d-4c0b-b7d0-36de2f6dee51/work/consumer`, with the same `preview:assets` npm script.

**Failures and limits.** Initial package typechecking found and corrected an animation type annotation. Sandboxed Vite configuration access failed; the unchanged production build passed with host access. The initial process-query probe was denied; verified runs used host access and retained process cleanup results. Earlier browser runs under `out/runs/2026-10-01T20-{43-19.802,45-06.812,47-04.788,48-44.536,52-08.250,54-11.141}Z-preview-*` remain failed evidence: a duplicate test variable, ineffective fetch injection, and ineffective WebGPU-disable flags. Final diagnostics use actual corrupt inputs and a public canvas-dimension fault through the real renderer callback. Missing-WebGPU startup and device loss/recovery were not separately established here.

The terminal's Ctrl+C input did not stop a separate manual launch; keyboard signal delivery remains unverified. Its known PID/port were checked, stopped using `taskkill` after `Stop-Process` failed internally, and confirmed absent/unreachable. The final automated run proves the Node SIGINT handler closes its server and exits zero; all owned verification processes were stopped and checked. No servers are intentionally left running.

No product decision was invalidated. The internal fixed stage is even-sized with a one-pixel minimum margin, capped at 8192 backing pixels; invalid/underflowing render or unrepresentable CSS dimensions fail visibly instead of fitting. The automated evidence above does not establish physical-GPU appearance or human motion judgment; the later human observations are recorded below. Other browsers/DPRs and every external animation remain outside this review. Stepping, magnification and contextual gameplay review remain deferred.

### Focused human review — 2026-10-01

- User confirmed `sub-0` was clear and displayed as described, with centered, complete artwork and clear edges.
- User confirmed `sub` and `jelly` motion was readable without unexpected jumping, clipping or flicker.
- User confirmed pause/resume, remaining paused after switching browser tabs, and `implosion` playing once, holding its final frame and restarting on Play.
- Reviewed the same installed Deepwell snapshot/package at `http://127.0.0.1:54627/`. Final in-app browser observation: renderer ready, implosion entry 5/5 paused at 1500/1500 ms, canvas 482×130, measured CSS approximately 482×130, viewport 786×998, DPR approximately 0.9. Browser zoom 100% was requested but not independently confirmed; DPR alone does not identify zoom. No physical GPU identity or broader device coverage is claimed.
- Review server stopped; its identified PID 10320 was absent and port 54627 was closed afterward. Keyboard Ctrl+C delivery remains unverified. No checks were rerun, no later features started, and Deepwell R4 acceptance remains unchanged.

**Historical documentation proposal, now applied (2026-10-02).** `tooling/README.md` now states that `build:package` cleans only `dist/engine` and `dist/preview`, compiles both targets, rejects linked emission directories and preserves other outputs. The guide's local installation recipe now uses `build:package` so a consumer tarball includes both targets.

### Remaining scope — 2026-10-02

- Implemented Previous/Next while paused, clamping and resetting elapsed time even at endpoints/once completion. Playing and standalone selections disable stepping. Added controlled-clock coverage for unequal/repeated entries, full-duration resume, boundaries and single-entry animations.
- Added labelled 1×/2×/4×/8× CSS inspection magnification, direct baseline reset and keyboard-scrollable stage. Backing dimensions and sprite geometry remain fixed; oversized CSS options are disabled.
- Added a generic alternating-stripe crop rendered at half size and installed-browser comparisons of baseline versus magnified pixels, plus control/geometry checks. This fixture remains independent of external consumers.
- Added concise supported setup, adapter fields, controls, rendering semantics and limitations to the guide; corrected the package-build documentation and linked the existing verifier from tooling guidance.
- Focused preview/preparation tests: 50 passed. Tooling and preview typechecks, affected-file Prettier and `git diff --check` passed. Exact-package browser results below.
- External verification reuses the previously identified isolated metadata/image snapshot; no Deepwell checkout, vendor, lockfile or saves are modified and its R4 acceptance stays closed.
- Human review passed: user confirmed correct preview behavior, paused stepping, motion and baseline restoration; accepted high-magnification scrolling for this step with future UI exploration recorded below. Accepted milestone 1 observations were preserved without a general rerun.

**Final candidate.** Base revision remains `856184412c53e8b8723c2db3177469fa149e7079`; implementation is unstaged/uncommitted. `ngne@0.1.0`, [exact tarball](../out/preview-final-package-verified/evidence/package/ngne-0.1.0.tgz), SHA-256 `68cc7a066b237191a1a0ee8547275cd61a651a2e8521c71f3e5cdab30192a5a0`. The [preparation manifest](../out/preview-final-package-verified/evidence/manifest.json) identifies uncommitted source/toolchain and packed/installed bytes. Preparation passed emitted declarations, root/nested normal-consumer builds and runtime graph exclusion; `check:prepared` passed. The browser manifests identify their final verifier and fixture hashes separately.

| Final evidence                                                                                                                                        | Result                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Generic preview](../out/runs/2026-10-02T05-28-19.225Z-preview-458011c9-0c88-40e5-ab42-f30c0e41dea7/evidence/result.json)                             | Passed installed module fidelity, paused/clamped stepping and disabled states, 2×/4×/8× CSS geometry, baseline/scroll reset, playback, diagnostics, disposal, SIGINT handler, integrity and process cleanup.                            |
| [Lost-detail pixels](../out/runs/2026-10-02T05-28-19.225Z-preview-458011c9-0c88-40e5-ab42-f30c0e41dea7/evidence/stages/detail-loss/observations.json) | 8×4 alternating red/green source rendered at 4×2: green stripes discarded. Every pixel of the 4× magnified screenshot exactly replicates the corresponding baseline screenshot pixel. Captures retained in the same evidence directory. |
| [External preview](../out/runs/2026-10-02T05-27-12.281Z-preview-885e8af9-5902-43be-8529-cbd66251f841/evidence/result.json)                            | Same tarball, fresh isolated installation of the existing identified external snapshot; stepping, magnification/baseline reset, playback/visibility, module fidelity, integrity and cleanup passed.                                     |
| [Installed engine](../out/runs/2026-10-02T05-27-43.371Z-installed-bea075fa-4586-4dbd-b83b-a30b8a5d23dd/evidence/result.json)                          | Existing root/nested installed-engine verification passed against this same exact preparation; cleanup passed.                                                                                                                          |

Preview browser environment: Windows `10.0.26200` x64, Node `24.15.0`, Chrome `154.0.8037.58`, headless SwiftShader, viewport 1082×698, DPR 1, fresh-profile browser zoom 100% and page scale 1. Generic canvas remains 20×24, baseline CSS 40×48; external canvas remains 482×130, baseline CSS 482×130. Magnification changes CSS bounds only. These establish software/browser behavior, not physical-GPU appearance, all browser/DPR combinations, contextual gameplay or human motion approval.

Commands (all reuse the exact manifest):

```powershell
npm.cmd run prepare:package -- --output out/preview-final-package-verified
npm.cmd run check:prepared -- --manifest out/preview-final-package-verified/evidence/manifest.json
npm.cmd run verify:preview -- --manifest out/preview-final-package-verified/evidence/manifest.json
npm.cmd run verify:preview -- --manifest out/preview-final-package-verified/evidence/manifest.json --fixture out/preview-m1-deepwell
$env:NGNE_WEBGPU_ADAPTER='swiftshader'
npm.cmd run verify:installed -- --manifest out/preview-final-package-verified/evidence/manifest.json
```

**Retained failed attempts.** `out/preview-final-package` failed sandboxed Vite directory access and CIM process cleanup. A later host query found none of its identified owned PIDs remaining; the original result remains failed. `out/preview-final-package-host` failed a Windows evidence-file rename; cleanup passed. Preview runs `2026-10-02T05-25-00.011Z-preview-a0b9e87b-a8a2-4768-8393-019eeba13ff6` (verifier label-expression escaping, fixed without changing the tarball), `2026-10-02T05-25-45.571Z-preview-9b9262fe-5a64-4089-a924-e515c540a9a3` and `2026-10-02T05-26-57.224Z-preview-d3ac1475-36a7-4e88-a13b-5ad2ca510718` (Windows evidence rename failures) remain failed evidence with successful process cleanup. Fresh complete passing runs above supersede them for acceptance; shared infrastructure was not changed to waive failures.

### Final human review and closeout — 2026-10-02

- User reported: “the preview tool is behaving correctly”; “paused stepping, motion and baseline restoration all work correctly”; “all looks good overall.” This completes the requested human review of external frames and motion at baseline and magnified sizes. The guided selection was `sub` and `jelly`; the user did not provide separate per-animation observations, so no broader asset coverage is claimed.
- User observed the rectangular preview area and overflow/scroll bars at 4× and above. They accepted this for the current step, provided a better solution is explored when the UI is next elaborated. This is an accepted ergonomics limitation, not an unresolved current implementation gate or approval of future UI work.
- Next UI design step: explore a viewport-bounded inspection area with deliberate pan/zoom and center retention, alongside the current scrolling approach. Preserve explicit baseline access, labelled magnification and scaling of already-rendered pixels; do not silently fit artwork or change its rendering density. Evaluate the rectangular stage and large empty margins as part of that exploration. No UI redesign is implemented or newly authorized here.
- Review used the exact final tarball and isolated external snapshot at `http://127.0.0.1:63645/`. Final observed state: `jelly`, paused at entry 4/4, renderer ready; canvas 482×130, baseline CSS 482×130, measured 2× CSS approximately 964×260, viewport 1274×998, DPR approximately 0.9. Browser zoom 100% was requested but not explicitly confirmed; DPR alone does not identify zoom. No physical-GPU identity, broader device coverage or contextual gameplay approval is claimed.
- Closed the owned browser tab to release its rendering resources, then stopped the review host through its existing process owner. [Review-host result](../out/preview-final-human/evidence/result.json): integrity and cleanup passed, no failures, process exited zero. PID 33324 was absent and port 63645 was closed afterward. All owned review/verification processes are stopped. Keyboard Ctrl+C delivery retains the earlier unverified limitation.
- No checks were repeated after human acceptance. Runtime/public API and Deepwell remain unchanged. All feature work and the three designated planning/report files remain unstaged and uncommitted; no push, publication, PR or issue mutation occurred.
