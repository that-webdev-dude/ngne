# NGNE v00 audit and promotion

The supplied workspace contained four architecture documents only. The ECS/scene implementations, contracts, renderer port and handoff documents mentioned in the old roadmap were absent. This implementation therefore bootstrapped all domains rather than depending on unavailable code.

The first integrated draft was authored in `src/`, then copied here as a runnable audit candidate. The final ownership fixes were made to this candidate before promotion back to `src/`. This is an integrated prototype gate rather than separate independently promoted domain prototypes; the actual sequence is recorded here rather than presented as the unavailable historical process.

## Round 1

Reviewed world lifetime, event/freeze order, scene failure isolation and the playable game. Added 20 executable checks. Fixed deterministic comparison to normalize per-world identity symbols (different worlds intentionally have different ownership tokens). Inspected the desktop and mobile game, launch and pause states.

## Round 2

Fixed cold-start loop rollback and resume failure preservation. Confirmed interpolation remains shared while freeze resets ordinary poses. Added a scheduler seam. Verified source-alpha blending, scene/layer order, texture upload and 10,000-sprite buffer growth against actual WebGL pixels. Context loss/restoration and browser stop/resume passed. Measured both CPU-only and actual browser workloads.

## Round 3

Made player identity a named resource, removed a retained tick-context callback, rejected mutable built-ins in committed state, fixed disposed audio/renderer/world access, and made audio cleanup best-effort. Added scoped-audio, preparation cancellation and mount-isolation tests. All 25 headless checks passed on the candidate. No known blockers remain in the implemented baseline. Hardware gamepad behavior and physical touch input remain unverified; scope explicitly excludes the architecture's deferred domains.

## Gate

```sh
node_modules/.bin/tsx --test prototypes/ngne/v00/tests/*.test.ts
npm run typecheck
npm test
npm run build
npm run bench
```

Windows uses `tsx.cmd` for the first command. After candidate tests pass, promote its engine, showcase and tests to their production locations and repeat the production checks. `promotion-manifest.json` records SHA-256 hashes of the promoted engine files. Frozen prototype code is evidence; production source and contracts are the supported authoring surface.
