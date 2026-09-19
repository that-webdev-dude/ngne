# Browser and presentation contracts

These contracts define browser lifecycle and input, WebGPU presentation, interpolation, assets and audio.

## Platform and lifecycle

Browser presentation requires a secure context (HTTPS or localhost), an available
WebGPU adapter/device and a WebGPU canvas context. Hardware acceleration must be
enabled for the supported desktop targets. Adapter acquisition can still fail due
to browser or driver restrictions; API presence alone is insufficient. The renderer
requests no optional GPU features or raised device limits. The README owns the
current support envelope; other browsers, GPUs and physical input modes require
separate validation.

Browser lifecycle overlaps:

| Call while another operation is pending           | Result                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start()` or `stop()` during start/resume or stop | Reject before side effects; the original operation continues. Await it before retrying.                                                                                      |
| `dispose()` during start/resume                   | Immediately disable frames and begin all teardown; late start success rejects as cancelled, and late failure retains its original error. Neither changes terminal lifecycle. |
| `dispose()` during stop                           | Begin teardown immediately. Stop may settle successfully or reject its own failures; it cannot replace `Disposed` with `Failed`.                                             |
| Repeated `dispose()`                              | Return the same promise, including its aggregated rejection; cleanup is attempted once.                                                                                      |
| Start/stop after disposal begins                  | Reject without recreating services.                                                                                                                                          |

The browser operation guard spans audio promises and Game startup completion.
`game.lifecycle` describes simulation lifecycle, so it may already be `Stopped`
while browser audio suspension is pending. Use BrowserGame lifecycle methods for
a browser-owned Game. Frame callbacks belong to one run; callbacks from a previous
run remain invalid even after successful resume.

Disposal initiates each independent cleanup without waiting for audio close before
releasing renderer/input. Its promise settles after all cleanup results and aggregates
all original failures. A superseded start/stop reports its own outcome through its
own promise; callers must handle both promises. Disposal does not wait for an
unsettled resume/suspend promise.

Headless `Game.start()` performs mounting and loop startup synchronously, although
its result is a promise. Invalid lifecycle calls reject. `Game.stop()` also cancels
preparations and unused candidates when already stopped, including before first
start. Cancellation cannot publish a late candidate; a shared asset load stays alive
while another consumer needs it. Cancelled loaders that eventually return data
dispose that data. An external loader that ignores abort may remain pending until
it settles, without retaining permission to activate a scene.

`Game` is headless. `BrowserGame` owns its input, renderer, audio and host frame scheduler. The injected scheduler must follow requestAnimationFrame semantics: asynchronous callbacks, cancellable IDs and monotonic millisecond timestamps. Late callbacks do no work after disabling. Cold loop failure rolls back the initial mounted world. Resume loop failure preserves it for terminal disposal. All independent teardown actions are attempted.

Default step: 1/60 second; budget: five ticks per platform frame. Excess whole ticks are dropped and reported, fractional remainder retained. No variable simulation delta. Display dimensions are fixed logical pixels; the backing canvas matches them and CSS scales presentation. Each frame latches display once. Each consuming tick receives one frozen input snapshot shared by every selected scene; pending edges survive frames without ticks and appear only on the first tick of a multi-tick frame.

The attached canvas is the focused input surface. Keyboard presses are accepted only
when their event targets that focused canvas; key releases remain window-observed so a
focus change cannot latch a key. Buttons, inputs, text areas and selects keep normal
keyboard behavior. Pointer coordinates are recomputed from the canvas's current client
rectangle for every event and mapped to fixed logical display pixels. Pointer cancellation
or capture loss releases every held `PointerN` action and clears pointer activity.

The lowest-index connected gamepad contributes to the same logical player only while
the canvas is focused. Disconnecting or switching pads releases the previous pad's held
buttons. Blur, `Input.clear()`, `BrowserGame.stop()` and disposal cancel held keyboard,
pointer and pad input; the same connected pad must return to neutral before it can be
acquired again. A later reconnect is a fresh pad input source. Native key codes,
`Pointer0`, `Pad0` etc. identify inputs; snapshots expose held/pressed/released arrays,
dead-zone-normalized gamepad axes, logical pointer coordinates/deltas and wheel delta.
The input contract provides one logical player and does not define explicit controller
assignment.

## Renderer

`WebGPURenderer.create(canvas, width, height, onError?)` asynchronously publishes a
complete renderer. Its synchronous `render(frame, clear?)`, `drawCalls`, `sprites`,
idempotent `dispose()` and readonly presentation `status` are separate from Game
lifecycle. Public-reachable declarations require no ambient WebGPU types; internal
device, encoder, registry and upload modules are not package subpaths.

`BrowserGame` always renders through WebGPU; `BrowserGame.renderer` is a
`WebGPURenderer` once acquired. Unsupported WebGPU rejects with an actionable message and
there is no fallback backend.

Cold image preparation may initialize the renderer, without attaching input, mounting,
starting audio or scheduling ticks. Startup shares that acquisition. A fully initialized
WebGPU renderer belongs to BrowserGame through stop and complete cold-start rollback;
retrying an unconsumed candidate reuses it. Failed initialization clears the rejected
acquisition for retry. Incomplete rollback/terminal host failure tears down presentation.
Stop invalidates a still-pending acquisition without mounted consumers. A later prepare
can acquire again. Disposal invalidates renderer ownership before Game/Assets close
decoded sources, attempts every independent teardown and aggregates failures.

BrowserGame alone restores its fixed logical backing dimensions before rendering;
CSS resize scales presentation only. Direct renderer callers own canvas dimensions.
Invalid dimensions/count/limits, unavailable image IDs and synchronous frame faults
skip the entire submission and report once per consecutive fault episode. A successful
frame resets suppression. Diagnostics cannot throw into simulation. Uncaptured device
errors report once per message per device. Instance-buffer growth failure is detected
asynchronously: later frames reallocate below the failed capacity, and frames that
still exceed it skip under the same episode suppression. That lowered cap lasts for
the device generation and resets only after device replacement.

Presentation transitions `ready → recovering → ready`, or `failed`; disposal is
terminal from every state. Each live-device loss starts one replacement attempt.
Replacement rebuilds the white texture, pipeline, buffers, bindings and all live image
sources on a fresh adapter/device, reconciling consumer changes before publication.
Old device callbacks and released/cancelled uploads cannot publish into the replacement.
Failed replacement (including a replacement lost before readiness) reports
`WebGPU recovery failed. Reload to create a new renderer` once and requires a new
BrowserGame. A subsequent loss after successful recovery may start another attempt.

Synchronous render skips during recovery. Running simulation may continue unchanged;
no scene, tick, accumulator, RNG, camera or prepared-key mutation follows GPU completion.
Resume waits for readiness before scheduling ticks. Stop never schedules a frame when
recovery completes. Browser diagnostics go to Game.report, with a contained console
fallback when no callback was supplied. Diagnostics also receive non-error notices
such as dropped-tick overload records. Hello appends flattened `Error` reports only,
so later notices or errors cannot hide startup or terminal failures. Use BrowserGame.dispose for a browser-owned Game.

`Frame` packs 14 float32 values (56 bytes) per sprite: `tx, ty, ix, iy, jx, jy,
u0, v0, du, dv, r, g, b, a`. The first six values transform unit-square corners:
`position = translation + corner.x * (ix, iy) + corner.y * (jx, jy)`.
Authoring still uses centered XY, signed size and rotation radians. Camera/shake
subtraction and optional center rounding happen before affine conversion. Sorting
remains scene, layer, depth and insertion. Adjacent texture runs batch without
texture-driven reordering. CPU/GPU buffers grow geometrically; there is no
per-entity GPU object or ECS access from rendering.

`Frame.count` defines the active prefix while packing. `reset()` resets logical
contents and retains metadata array capacity; raw readers must not traverse stale
tails. `sort()` trims `order` and `textures` to the active count before ordering.
This avoids repeated backing-array growth for a steady workload.

### Camera coordinates

`camera.x/y` is the world position of the viewport's top-left. No-argument `cut()` copies current coordinates to previous coordinates without moving the camera. `cut(x, y)` assigns both current and previous coordinates to the supplied position. The engine's post-mount cut is the no-argument form, so scene setup must position the camera before returning.

Camera base and gameplay poses share interpolation; snapping happens after composing camera and pose, without simulation writes. Shake is a separate offset. Authors own previous/current component fields and register resets. Presentation systems that continue during freeze own separate particle values. Mounting initializes previous/current together.

### Interpolation and discontinuities

| Boundary                                | Responsibility and rendered result                                                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount                                   | Authors initialize all previous/current poses together, including effects and later spawns. After setup/world commit, NGNE cuts the camera and invokes ordinary reset callbacks before publication.                         |
| Ordinary update                         | NGNE calls `camera.beginTick()` before the schedule. Authors copy ordinary previous poses before moving them. Camera and sprite preparation use the same scene alpha.                                                       |
| Teleport / cut                          | Authors assign previous/current together for the affected actor and call `camera.cut(x, y)` for a camera cut. These are independent operations; cutting one does not reset the other.                                       |
| Freeze activation                       | After world commit and the full schedule, NGNE cuts the base camera and invokes ordinary reset callbacks. Ordinary poses are exact even at alpha 0.                                                                         |
| Frozen update / final countdown tick    | Ordinary poses stay fixed. Separate continuing effects update previous/current and interpolate with the frame alpha, including the tick whose countdown reaches zero. Do not force the entire scene to alpha 1 for hitstop. |
| First ordinary update after freeze      | Previous poses start at the frozen current pose; movement and camera resume with the same alpha.                                                                                                                            |
| Blocking scene publication / suspension | Lower scenes render with alpha 1 immediately, including on the push commit frame. All their systems and freeze countdown remain suspended.                                                                                  |
| Uncovered scene / host resume           | Use alpha 1 until that scene next updates, then use the shared frame alpha. Preserved component/camera values are not rewritten. Stopped games perform no render work.                                                      |

`SceneInstance.canInterpolate` is presentation eligibility, excluded from simulation
inspection. Stack selection and this flag choose the same alpha for `Frame.scene`
and the authored render callback; it changes no simulation state. Frame preparation
subtracts interpolated camera plus shake before `Math.round` when `pixelSnap` is true.
Screen-space sprites bypass camera/shake but still snap. Packed coordinates are
float32; JavaScript half-pixel rounding applies, including negative coordinates.

WebGPU uses the premultiplied pipeline and retained source ownership described above. The shared asset cache retains decoded data until disposal.

## Assets and audio

### Referenced consumer content

NGNE prepares the explicit `SceneDefinition.assets` list; it does not traverse
JSON references. Consumers resolve and validate their complete required graph before
calling `prepare`, flatten its resource definitions into that list, and reuse one
definition object per asset ID. Listing an atlas JSON value alone does not prepare
its image. Every referenced image must appear as an `ImageAsset`; decoding is not
GPU readiness. The browser hook below supplies that readiness for each listed image.

Consumers own document schemas, URL bases, missing-reference and cycle detection,
duplicate-edge deduplication, conflicting-definition rejection and deliberate retry.
Navigation targets are distinct from required dependencies: a return doorway need
not recursively load another scene. Repeated animation frames are playback data,
not additional asset claims. Immutable validated snapshots can be scene assets;
temporary document-request claims may end after creating that snapshot, before
engine preparation begins. A failed resolver must release its own claims and never
publish a partial scene. No registry, format parser or automatic discovery API is
provided by the engine.

### Decoding, upload and recovery

`ImageAsset extends Asset<ImageBitmap>` carries readonly `kind: "image"`.
`imageAsset()` uses explicit non-premultiplied, unconverted bitmap decoding; image
bytes are authored as sRGB. Custom image loaders must follow the same convention.
The WebGPU browser host waits for validated texture upload during preparation.
Setup still receives decoded values; no GPU handles enter components, assets,
prepared handles, Game state or enumeration. Headless preparation has no GPU hook.

The internal `PREPARE_ASSET` symbol returns a Promise of an optional synchronous,
idempotent cleanup callback. Game owns the CPU lease before awaiting that hook,
combines cleanup in GPU-before-CPU order and releases late results after cancellation.
All candidate-slot paths use this preparation function. Rejected decoded loads are
identity-evicted immediately, so a retry can begin while older consumers unwind.

WebGPU image entries are keyed by string ID and definition identity. Overlapping
consumers share one upload and one additional retained source lease. Cancellation
releases only its consumer; the final release unregisters bindings before destroying
the texture and releasing that lease. The decoded cache closes sources only on Assets
disposal. Conflicting/manual/leased IDs reject; empty ID is reserved for white.
Validation and out-of-memory scopes finish before readiness is published, including
when the copy throws synchronously. Failed uploads permit explicit retry.

`WebGPURenderer.texture(id, bitmapOrCanvas, signal?)` snapshots the caller's image
and retains its own bitmap until replacement/disposal. The caller can close or change
its original after resolution. Replacement is transactional; cancellation/failure
preserves the old ready binding. Already-premultiplied inputs may have lost precision
before snapshotting; the renderer cannot reconstruct those original bytes.

Asset identity must map to one definition object per service. Leases release once; loaded cache entries remain until disposal. Cancelling one consumer does not abort a load still needed by another. The last cancelled pending consumer aborts the loader. Late completion after cancellation disposes its returned value and cannot activate a scene.

The playback device is optional until unlocked by a user gesture. Named scopes are internally instance-isolated, even with the same authored name. Effects use oscillator envelopes; clips use decoded AudioBuffers, optionally looping. Scope buses support independent gain; the master supports mute and ducking. Requests flush after simulation commit, and unmount removes queued/active scope voices before releasing scene asset leases. Scope and terminal disposal become final before cleanup, attempt every owned voice, gain and bus action, and aggregate failures; a failed cleanup cannot make that scope usable again. Unlock, resume and suspension failures propagate. Suspension clears queued requests before awaiting the device. Limits: 128 pending requests and 32 active voices; excess is dropped. Audio presentation state is outside simulation enumeration.

The engine provides no entity collision schema. Starfall owns a spatial grid resource and collision rules. The engine does not provide snapshot capture, restore, replay or editors.
