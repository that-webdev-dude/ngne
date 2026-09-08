# NGNE verification

Local verification on 7 September 2026, Windows x64, Node v24.15.0, Chromium-based Codex browser. These are local observations, not cross-device guarantees.

## Automated checks

- 25 headless tests: entity visibility, churn, stale/foreign handles, query stability, input edges, fixed-step overload, deterministic RNG, committed state, freeze/events, suspension, scene command failure, private cleanup, setup restrictions, stop/resume, startup failure, terminal disposal, shared asset cancellation, camera and draw order, scoped audio and complete gameplay.
- Two equal-seed games produce identical normalized simulation enumerations after 600 ticks.
- An 11,000-tick Chaos Lab check completes the three-minute run, commits a victory and score, and stays below 20,000 entity slots.
- Strict TypeScript and production build pass; emitted engine declarations are separate from the bundled game.

## Real browser checks

`/validation.html` passed all 12 checks:

1. Layer order independent of submission order.
2. Scene order takes precedence over local layer.
3. Correct source-alpha pixel compositing.
4. Decoded texture upload and UV sampling.
5. 10,000 synthetic sprites in one instanced draw.
6. No WebGL error after buffer growth.
7. Safe submission skip during deliberate context loss.
8. Shader, buffer and texture restoration after context recovery.
9. Browser host drives fixed simulation.
10. Late stopped callbacks perform no work.
11. Resume preserves scene identity and resets wall-clock accumulation.
12. Browser teardown completes.

Game UI: desktop and 390px mobile viewport inspected; no horizontal overflow in the measured mobile document. Start, pause and resume render the correct states. Sound toggle accepts the gesture and switches state. The production preview also passed launch and resume; Space triggered a nova and its recharge counter was observed. Original pixel artwork renders; console had no application errors. Audio graph behavior has automated coverage; subjective audio quality and physical gamepad/touch operation are not claimed verified.

## Performance

CPU benchmark (`npm run bench`), 100 warmup iterations, then 300 ECS samples; chaos samples exclude the first 101 of 900 ticks:

| Workload | Median | p95 |
| --- | ---: | ---: |
| Update 20,000 entities with position + velocity | 0.240 ms | 0.503 ms |
| Chaos simulation + frame preparation + sort | 0.656 ms | 0.917 ms |

The chaos benchmark reached 7,209 sprites and 6,986 entity slots. These CPU numbers exclude input polling, WebGL upload/submission, GPU execution, DOM presentation and display synchronization.

Actual game: ten DOM telemetry samples, one second apart, while Chaos Lab was active:

| Metric | Observed |
| --- | --- |
| Smoothed display FPS | 60 in all ten samples |
| Sprites | 6,456–6,590 |
| Draw calls | 2 |
| Reported CPU frame work | 1.4–8.2 ms |
| Additional dropped ticks during sampled interval | 0 |

The cumulative dropped counter was already 9 at the start and remained 9. These observations do not prove zero stalls, GPU timings, or a p95 distribution; the UI reports individual CPU samples and smoothed FPS. The earlier counter includes activity before the sampled interval. Development hot reload, backgrounding, and browser tooling can affect frame timing.

## Limits

No mobile hardware, physical gamepad, Firefox or Safari run was performed. WebGL 2 is required. Save/restore, replay controllers, networking, editors, local multiplayer and other explicitly deferred capabilities were not implemented. The process and source audit are recorded in `prototypes/ngne/v00/AUDIT.md`.
