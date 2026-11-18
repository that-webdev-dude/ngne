# Changelog

## [Unreleased]

## [0.4.0] - 2026-11-18

### Added

- `Camera.zoom` and `Camera.previousZoom` (default 1) scale world-space quads about the viewport's top-left, so `camera.x/y` stays the world position at that corner. Zoom interpolates with the scene alpha; `beginTick()` copies it, `cut()` resets it and `cut(x, y, zoom)` sets it. Shake is a world-unit offset scaled with the camera; `pixelSnap` rounds in screen pixels after scaling, so integer zoom maps each texel to whole pixels. Screen-space sprites are unaffected, and zoom 1 packs and renders exactly as before. A zoom must be a finite number greater than 0: `cut(x, y, zoom)` throws a `RangeError` for an invalid argument without changing the camera, and an invalid assigned `zoom` or `previousZoom` makes frame preparation throw a `RangeError`, which fails a `BrowserGame`. Scene inspection now lists both zoom fields with the camera. See [camera coordinates](docs/contracts/browser-and-presentation.md#camera-coordinates).
- Per-texture sampling with the `TextureSampling` type: `filter` is `"nearest"` (default) or `"linear"`, `address` is `"clamp"` (default) or `"repeat"`. Pass it as the optional last argument of `WebGPURenderer.texture()` and `createTexture()`, or of `imageAsset(id, url, sampling)`; custom `ImageAsset` definitions can set `sampling`. The choice is fixed for the registration, survives device recovery, and keeps batching by texture unchanged. Repeat tiles whole-texture UVs outside 0–1, not atlas sub-rectangles; there are no mipmaps, so linear minification can alias. Invalid sampling rejects before it changes any registration or pending replacement, and `imageAsset()` throws for it. Registrations without sampling render exactly as before.
- `WebGPURenderer.submittedWorkDone(signal?)` resolves once the GPU work submitted before the call, including `render()` frames and texture uploads, has completed, so a direct renderer host can cap frames in flight. Frames that skip submission are never waited on. Cancellation rejects with `signal.reason`; device loss resolves the wait because the lost device's work is abandoned, and a call during recovery resolves at once; terminal failure and disposal reject. The renderer tracks nothing per frame, so hosts that never call it pay no cost. The device stays private and declarations still need no WebGPU types. See the [renderer contract](docs/contracts/browser-and-presentation.md#renderer).
- Per-sprite hardware clipping with `Sprite.clip` and the `ClipRect` type (`x`, `y`, `width`, `height`): integer render-target pixels with a top-left origin and exclusive right and bottom edges, not CSS pixels and not scaled by the device pixel ratio. World and screen-space sprites use the same clip; camera movement, shake, zoom and snapping move the sprite, never the clip. Values are copied when the sprite is added, and clipping adds no sort key. Adjacent sprites with the same texture and the same effective clip (by value) share one draw; a clip change splits the draw. A clip is intersected with the render target, and an empty result draws nothing, while the sprite still counts in `sprites` and still needs a ready texture. An invalid clip (non-integer, non-finite, unsafe or with a negative size) skips that frame's submission with a `RangeError` diagnostic; later frames render normally. Sprites without a clip render exactly as before. See [sprite clipping](docs/contracts/browser-and-presentation.md#sprite-clipping).
- Guide section on keeping per-frame sprite authoring fast with many sprites. See [many sprites per frame](docs/guide.md#many-sprites-per-frame).
- Tilemap-shaped ordering benchmark workload (`keys=tilemap`, 66,560 quads by default, optional `count` and `columns`) with a sort-path audit, for measuring frame preparation cost per quad at tilemap scale.

### Changed

- Sprites without a clip keep the 0.3.1 frame preparation cost. Adding clipping had grown `Frame.sprite()` past V8's cumulative inlining budget, so each sprite paid a separate packing call; the authoring path is now small enough to inline again, with packed instances, draw calls, upload bytes and clip behaviour unchanged. On the fixed 10,000-sprite renderer benchmark (Windows 11, i7-12650H, Intel UHD hardware WebGPU, Chrome 157, headed; three alternating fresh-process runs each, 30 s samples, 2026-11-17), mean preparation was 0.185–0.189 ms against 0.173–0.194 ms for 0.3.1 and 0.377–0.382 ms without this change; an earlier batch the same day measured 0.209–0.231 ms against 0.170–0.174 ms. Timings are main-thread CPU with 0.1 ms timer resolution. The result depends on the browser engine's inlining heuristics and on how much other code shares the calling loop; other browsers, NVIDIA GPUs and slower CPUs were not measured.

### Fixed

- With `camera.pixelSnap` true, frame preparation rounds the packed translation corner instead of the centre, so snapped quads of any integer width and height, including odd and flipped sizes and quarter-turn rotations, cover whole pixels and map texels 1:1. Odd-sized quads can move half a pixel compared with 0.3.1; even-sized unrotated quads and `pixelSnap = false` output are unchanged. Other rotations snap only the translation corner. See [interpolation and discontinuities](docs/contracts/browser-and-presentation.md#interpolation-and-discontinuities).

## [0.3.1] - 2026-11-15

### Added

- Raw RGBA8 input for `WebGPURenderer.updateTexture()` with the `RgbaPixels` type: tightly packed, straight-alpha sRGB bytes, with sRGB `ImageData` accepted. The requested region is copied when the call is made, so callers can reuse their buffer at once. Raw updates skip bitmap creation, canvas drawing and pixel readback, and keep every supplied byte, including colour under zero alpha, in the texture and the recovery image. Bitmap and canvas sources keep their existing capture and precision limits. See [editable manual textures](docs/contracts/browser-and-presentation.md#editable-manual-textures).

### Changed

- Consolidated installation, sprite preview, audio and benchmark comparison guidance; corrected stale version examples and clarified repository validation links.
- The publication workflow creates the GitHub release after registry verification passes, using the version's changelog section and the verified publication result. An existing release is accepted and never overwritten.
- Retired the bundled Starfall demo and Starfall-specific benchmarks. The README now links to the standalone game; Hello and Platformer remain maintained examples, with engine regression coverage preserved.

## [0.3.0] - 2026-10-23

### Added

- Editable manual textures with `WebGPURenderer.createTexture()`, `updateTexture()` and `TextureRegion`, reusing fixed-size GPU storage and bindings for ordered dirty-region updates and retaining accepted edits for device recovery. Existing `texture()` replacement remains transactional. See the [ownership, cancellation and failure semantics](docs/contracts/browser-and-presentation.md#editable-manual-textures).
- Direct renderer resizing with `WebGPURenderer.resize(width, height)`, preserving GPU resources and textures.
- Manual texture release with `WebGPURenderer.releaseTexture(id)`, including safe ID reuse across pending uploads and device recovery.
- Cancellable renderer creation, `ready(signal?)` waits and `onLifecycle()` subscriptions, with exclusive canvas ownership.

### Changed

- Moved release-candidate source binding and immutable assembly from workflow scripts into checked TypeScript tooling, preserving validation before dependency installation, artifact identity checks and explicit publication approval.
- Accelerated large frame ordering with a guarded stable layer-counting sort and an already-ordered input check, preserving canonical scene/layer/depth/insertion order and the existing comparator fallback. Three rotated hardware-WebGPU rounds measured 48.9–54.6% lower synchronous frame CPU time at 64K interleaved quads and 57.6–60.4% at 128K; the ordered late-depth case improved by 12.7–15.9%. Unsupported inputs can still pay eligibility-scan overhead; these fixture results do not establish universal FPS or consumer gains. See the [three-version measurements, reproduction sources and limitations](https://github.com/that-webdev-dude/ngne/releases/download/v0.3.0/frame-sort-three-version-2026-10-16.zip).

### Fixed

- Retry transient Windows evidence-file replacement failures, clean up temporary files and preserve evidence and cleanup errors without accepting incomplete runs.
- Preserve unsubmitted editable-texture updates and initialization across readiness races during device recovery, without replaying submitted patches.

## [0.2.2] - 2026-10-15

### Changed

- Reduced ECS chunk descriptor construction time by defining its four outer properties individually, preserving borrow lifetimes and same-epoch reuse. The measured 128K-entity Node benchmark's first-traversal median improved by 15.9%; this does not establish an allocation reduction or game/FPS gain. See the [paired results and limitations](https://github.com/that-webdev-dude/ngne/releases/download/v0.2.2/outer-descriptor-experiment-2026-10-11.json).
- Refreshed onboarding, example instructions and documentation links; included architecture documentation in the package.

### Fixed

- Allow preview startup when package path casing differs from disk, while still rejecting linked engine files and directories.
- Allow up to ten minutes for npm to list an attempted OIDC publication, retaining every registry read and preserving single-upload and identity/provenance checks.
- Preserve investigation workload and measurement-writing errors alongside browser cleanup failures, and include each case's cleanup in aggregate acceptance.
- Reject unlisted evidence files in current benchmark and content-baseline readers, sharing the exact artifact inventory check with package preparation and consumer validation.

### Added

- ECS density and ordered/shuffled rendering benchmark fixtures for performance investigation.
- Browser investigation runner with explicit engine or consumer fixture selection, optional profiling, and tested frame/tick measurement summaries.
- Preserved the 2026-10-11 investigation's raw measurements, profiles, logs, and reproduction files in a checksummed evidence archive.
- Regression coverage for chunk descriptor property order and flags, frozen opaque shape, and detached accessor expiry after commit or disposal.
- Checksummed descriptor attribution, paired timing, and clean full verification evidence archives.
