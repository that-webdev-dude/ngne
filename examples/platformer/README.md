# Platformer

Run `npm run dev` from the repository root, open `/examples/platformer/`, then choose **Start level 1**. Requires WebGL 2; the Start gesture unlocks synthesized audio.

| Action                           | Keyboard / button            | Gamepad input read by the example |
| -------------------------------- | ---------------------------- | --------------------------------- |
| Move                             | A / D or left / right arrows | Horizontal axis `axes[0]`         |
| Jump; hold for height            | Space, W or up arrow         | `Pad0`                            |
| Pause / resume                   | P, Escape or Pause / Resume  | `Pad9`                            |
| Start / restart after completion | Enter or Start / Play again  | None                              |

Gamepad codes follow the browser's mapping; physical gamepad and touch controls have not been validated. Hiding the tab requests pause.

The two levels demonstrate:

- Game-owned tile resources, collision, one-way platforms, hazards and patrols.
- Committed checkpoint/level progress; death remounts entities from durable facts, resetting patrols.
- A host-owned candidate registry with scene-owned transition authority and a blocking pause overlay.

The deterministic reference walkthrough in [the tests](../../tests/platformer.test.ts) completes both authored levels with zero deaths. See [findings and validation limits](FINDINGS.md); browser playthrough remains separate evidence.
