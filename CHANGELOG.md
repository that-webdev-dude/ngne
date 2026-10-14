# Changelog

## [Unreleased]

### Added

- ECS density and ordered/shuffled rendering benchmark fixtures for performance investigation.
- Browser investigation runner with explicit engine or consumer fixture selection, optional profiling, and tested frame/tick measurement summaries.
- Preserved the 2026-10-11 investigation's raw measurements, profiles, logs, and reproduction files in a checksummed evidence archive.
- Regression coverage for chunk descriptor property order and flags, frozen opaque shape, and detached accessor expiry after commit or disposal.
- Checksummed descriptor attribution, paired timing, and clean full verification evidence archives.

### Changed

- Reduced ECS chunk descriptor construction time by defining its four outer properties individually, preserving borrow lifetimes and same-epoch reuse. The measured 128K-entity Node benchmark's first-traversal median improved by 15.9%; this does not establish an allocation reduction or game/FPS gain. See the [paired results and limitations](tooling/suites/benchmarks/evidence/outer-descriptor-experiment-2026-10-11.json).

### Fixed

- Reject unlisted evidence files in current benchmark and content-baseline readers, sharing the exact artifact inventory check with package preparation and consumer validation.
