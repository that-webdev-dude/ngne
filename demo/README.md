# Starfall '89

The repository showcase uses NGNE's public API. From the repository root, run
`npm ci` and `npm run dev`, then open the printed local URL. Use `npm.cmd` in
Windows PowerShell. Rendering requires WebGPU on localhost or HTTPS; the Start
gesture unlocks audio. See [art direction](DESIGN.md) for presentation choices.

## Ownership inventory

This inventory illustrates the [engine ownership contract](../docs/contracts/ownership-and-inspection.md).
Game-specific values and derived caches below remain owned by the showcase.

### Starfall durable facts

Game state owns `best`, `runs`, `victories` and `lastScore`; finish commands capture
score and win before transition.

### Starfall gameplay

`run` owns phase, score, wave, seconds/ticks, hp, bomb, combo/countdown, stress,
spawn/shot timers, invulnerability, boss-wave and finished flag. The `player`
resource owns its handle. Schema components own the rest: `position` (`x`, `y`,
`px`, `py`: `f64`) and `body` (`vx`, `vy`, `radius`, `hp`, `age`, `cooldown`:
`f64`; `active`: `bool`; `kind`: `u8`). Systems locate the player's row from its
handle each update and never retain it. The `waves` RNG owns spawn/drop randomness.
The decoded `ships` atlas is an `ImageAsset` lease owned by each prepared scene; no
component field or resource holds it.

### Starfall derived cache

The `collision-grid` resource stores entries of entity handle, borrowed `position`
and `body` chunk component views, and chunk-relative row. Every continuing ordinary
gameplay update clears and rebuilds it before collision reads, so entries are probed
only in the commit epoch that created them. After commit, retained entries are
expired borrows that may name removed entities or moved rows: they are neither an
authority nor a list of current entities, and inspection shows their views as empty
records. Query match/column caches are likewise derived from definitions and
archetypes, preserving their order.

### Starfall presentation within simulation

`visual` (`sprite`: `u8`; `size`, `angle`: `f64`), previous poses, `particle`
(`vx`, `vy`, `life`, `maxLife`, `size`: `f64`; `color`: `u32`), the `effects` RNG,
`run.shake/flash`, camera shake and `stars` are scene-owned and inspectable. Particle
updates continue through freeze and share ECS allocation with gameplay: their
lifetime cannot be omitted when reproducing allocator identity. Stars are generated
once using `waves`, so mount-time draws are part of deterministic setup.

### Immutable authoring

Component schemas/names, scene setup/ID/policy, ordered systems and freeze flags,
reset/render callbacks, transition function, arena attract/stress/reduced-motion
options, dimensions, sprite/atlas definitions and texture key `ships` are
code/configuration, not serialized values. Treat supplied definitions/options as
fixed; readonly typing does not deep-freeze arbitrary authored objects or callback
captures.

### Demo UI and hello

DOM `view`/`presentation`, prior phase, metrics/times and UI readiness are
host/presentation state. View copies do not grant gameplay mutation. Hello's
moving/previous X values are components; its query/callbacks contain no mutable
gameplay counters. Art generation has only call-local drawing work.
