# Changelog

## [Unreleased]

### Changed

- The publication workflow creates the GitHub release after registry verification passes, using the version's changelog section and the verified publication result. An existing release is accepted and never overwritten.

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
