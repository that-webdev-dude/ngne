# Installed engine coverage correspondence

The engine-only fixture is [index.ts](../../tooling/fixtures/installed-engine/index.ts).
The workflow is [installed.ts](../../tooling/suites/verification/browser/installed.ts).
The [recorded local evidence](../../docs/evidence/installed-engine.json) contains the
actual root/nested observations, package/workload identities and cleanup outcomes.
This is replacement evidence for the engine concerns below, not permission to
delete the source scenarios. All retirement gates remain blocked.

| Existing engine concern in `tests/browser-content-checks.ts`                   | Installed fixture observation IDs                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image readiness before initial activation; delayed decode cannot activate      | `image-upload-ready-before-mount`, `cold-preparation-does-not-mount-or-schedule`, `delayed-image-cannot-publish-or-mount`                                                                                             |
| External image presentation and recovery pixels                                | `external-image-texels-present`, `recovered-image-texels-present`, `external-assets-use-selected-base`                                                                                                                |
| Surviving image consumers and protected leased working set                     | `overlapping-candidates-share-upload`, `candidate-release-preserves-survivor`, `leased-working-set-protected-from-retention`                                                                                          |
| Failure, explicit retry and cancellation without stale activation              | `failed-asset-preparation-rejects`, `failed-preparation-releases-claims`, `failed-load-can-explicitly-retry`, `cancelled-preparation-rejects`, `late-cancelled-load-disposed-once`, `cancelled-image-never-registers` |
| Audio unlock and actual destination-input signal                               | `cold-preparation-does-not-unlock-audio`, `decoded-clip-produces-output`; retained `firstRms` sample                                                                                                                  |
| Transition releases previous scope and starts the next without unlocking again | `replacement-unmounts-old-owner`, `replacement-plays-new-scope`; `replacementRms` measured after the previous analyser window has elapsed                                                                             |
| Recovery preserves simulation and submits through replacement device           | `recovery-preserves-simulation`, `recovery-restores-live-source`, `recovered-frame-submits`                                                                                                                           |
| Cancelled preparation during recovery preserves mounted consumer               | `recovery-preparation-cancellation-rejects`, `recovery-cancellation-preserves-mounted-owner`                                                                                                                          |
| Stop/resume and recovery cannot schedule stopped frames                        | `stop-disables-frames-and-audio`, `stopped-recovery-does-not-schedule`, `resume-retains-mounted-scene`                                                                                                                |
| Terminal recovery failure remains reported and disposable                      | `failed-recovery-is-terminal-and-reported`, `failed-renderer-disposal-releases-sources`                                                                                                                               |
| Disposal invalidates pending acquisition and releases late resources           | `disposal-cancels-pending-image-preparation`, `disposal-destroys-late-device-and-releases-assets`                                                                                                                     |
| Final resource/audio ownership release                                         | `disposal-releases-all-owners`, `disposal-closes-audio`, `disposed-host-cannot-restart`                                                                                                                               |

Public imports/declarations, API misuse and isolated resolution execute during
preparation. Both base builds retain external PNG/WAV files. Runtime resolution,
TypeScript resolution and Vite module boundaries reject source fallback. Tooling
regressions cover aliases/inherited configs, incorrect declaration targets,
malformed browser reports, invalid preparation and nested-server containment.
Existing preparation regressions retain tamper, incomplete evidence, disposable
copy, failure independence and cleanup rejection coverage.

The original consumer scenarios remain executable and unchanged. Their authored
JSON validation, loading UI, room-specific counts, distinct environment art,
animation, controls, candidate-slot travel policies, saves and progression are not
replaced by this minimal fixture. Engine unit/browser contract tests also remain
active. The frozen assertion IDs and their retirement gates are preserved;
consumer migration must establish its own precise coverage before deleting mixed
scenarios. Runtime assertion counts do not establish equivalence.

Recorded runs are Windows Chrome/SwiftShader evidence. They establish neither
physical-GPU validation, manual audible/visual approval nor a hosted Linux pass.
The old frozen-workload recovery timeout remains a historical unresolved failure;
these controlled fixture results do not establish its cause or repair it.
