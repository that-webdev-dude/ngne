# Platformer

Run `npm run dev` from the repository root, open `/examples/platformer/`, then choose **Start level 1**. Requires WebGPU with hardware acceleration; without an adapter, Start shows the engine's capability message instead of a blank canvas. The Start gesture unlocks synthesized cues and scene-leased looping music.

| Action                           | Keyboard / button            | Gamepad input read by the example |
| -------------------------------- | ---------------------------- | --------------------------------- |
| Move                             | A / D or left / right arrows | Horizontal axis `axes[0]`         |
| Jump; hold for height            | Space, W or up arrow         | `Pad0`                            |
| Pause / resume                   | P, Escape or Pause / Resume  | `Pad9`                            |
| Start / restart after completion | Enter or Start / Play again  | None                              |

Gamepad codes follow the browser's mapping; physical gamepad and touch controls have not been validated. Hiding the tab requests pause.

The two levels demonstrate:

- Schema-defined typed-array components (`f64`, `bool`, `u8` fields) traversed with `eachChunk`; the player's row is located per update from its canonical handle.
- Game-owned tile resources, collision, one-way platforms, hazards and patrols.
- Committed checkpoint/level progress; death remounts entities from durable facts, resetting patrols.
- Engine-owned, scene-scoped candidate slots with game-owned transition intent and a blocking pause overlay.

The deterministic reference walkthrough in [the tests](../../tests/platformer.test.ts) completes both authored levels with zero deaths. Browser controls and audio require separate browser validation.
