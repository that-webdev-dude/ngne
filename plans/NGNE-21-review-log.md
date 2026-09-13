# NGNE-21 plan review log

Append-only coordination record. Plan: [NGNE-21-webgpu.md](NGNE-21-webgpu.md). Date: 11 September 2026. Planning and review authorized; implementation, Jira mutation, commits, push and publication are not part of this task.

## Roles and limits

- Host/planner/coordinator: current Codex task; preserve its selected model.
- Reviewer: Claude, explicitly requested runner model `opus`; no effort override.
- Default later builder: Codex; fresh final inspector: Claude Opus; inspection enabled. Maximum five completed plan review rounds, two build-fix attempts, two implementation inspections when a build is authorized.
- Skill: `C:/Users/jfabi/.agents/skills/claudex-loop/SKILL.md`; runtime reference and absolute installed runner read before execution.
- Runner: `C:/Users/jfabi/.agents/skills/claudex-loop/scripts/runner.py`.
- Python: `C:/Users/jfabi/AppData/Local/Programs/Python/Python313/python.exe`; `PYTHONIOENCODING=utf-8` set for runner calls.
- Claude executable: `C:/Users/jfabi/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe`; observed version `2.1.269`.
- All planning artifacts stay in `plans/`; runtime diagnostics stay in private temporary directories outside the checkout.
- Recon HEAD: `94a70a0393060707908a226c9e2d2107bdbae01c`; NGNE working tree initially clean. Pinned cluster-renderer HEAD `34458a987f03b00894e98a40d39fc0ae666194f6` matched, source working tree clean. Source read only. Per-command safe.directory override used for source Git inspection; no global configuration change.
- Applied skills: claudex-loop, ponytail, webgpu. Reviewer safe mode does not inherit skills/MCP; necessary source constraints and references are in the plan. No proprietary build/browser capabilities are assumed in the reviewer.

## Communication gate

Planning paused when the sandbox could not execute native Claude. An escalated version check succeeded. The first disposable probe invocation was rejected before launch because its diagnostics were inside its fixture repository; corrected the artifact directory to a sibling. Neither operational attempt counts as a plan review round.

Two no-op probe reviews completed successfully before NGNE-21 reconnaissance continued:

- First result: `C:/Users/jfabi/AppData/Local/Temp/ngne-21-claudex-probe-round-1-20260911/claudex-6a_n5m7d/result.json`.
- Resumed result: `C:/Users/jfabi/AppData/Local/Temp/ngne-21-claudex-probe-round-2-20260911/claudex-3snc_j62/result.json`.
- Exact session in both: `fd2b51f0-d531-4fae-bfdf-9ebae9beb380`; both status completed, exit 0, verdict APPROVED for the disposable no-op only, permission denials empty.
- Requested model `opus`; first probe observed model keys included `claude-opus-5` and auxiliary `claude-haiku-4-5-20251001`; resumed review observed `claude-opus-5`. These usage keys are reported separately from the requested model.
- The resumed summary explicitly acknowledged receipt of host-authored feedback and remembered the first review. Runner session resume and feedback communication are verified, not inferred from process launch.
- Inspected command.json: `--safe-mode`, `--strict-mcp-config`, empty MCP servers, tools/allowedTools `Read,Glob,Grep`, permission mode `dontAsk`, no Chrome, structured JSON schema, explicit `--model opus`. No restriction weakened.
- This probe is not NGNE-21 approval and does not consume its five-round budget. NGNE-21 starts a fresh reviewer session.

## Recon and requirements

Live Jira NGNE-21 includes explicit v03 reuse, 14-float affine packing, CPU camera/order ownership, straight-to-premultiplied alpha, approved WebGPU types, device recovery, image readiness and WebGL retention through NGNE-27. Both blocker links are Done. Sources and the resolved assumptions/decision map are recorded in the plan; no unresolved product decision required a user question.

Repository evidence: renderer/browser/assets and scene preparation/candidate/teardown paths; raw frame readers; contracts/architecture/decisions; current scripts and tsconfigs; NGNE-26 dated measurement harness. Source evidence: specified v03 GPU modules, TextureAssets, layout conformance test and D-30–D-34. Primary API references fetched as linked in the plan. Full W3C WebGPU page exceeded tool size limit; this limitation is explicit.

The planning-only checks are Markdown format/link/source consistency, protocol verification and exact hash approval. Implementation proof commands and real hardware checks remain future work, not claimed executed.

## Round 1 — REVISE

Successful structured review; session 43d70e0b-4c94-4a92-9668-929efbdf4fea. Requested opus; observed claude-opus-5 plus auxiliary Haiku usage. No permission denials. Three medium and nine low findings. Full runner result follows, including coverage and limitations.

Result: C:\Users\jfabi\AppData\Local\Temp\ngne-21-plan-review-20260911\claudex-vuv6wxym\result.json

```json
{
  "status": "completed",
  "mode": "review",
  "provider": "claude",
  "roles": {
    "host": "codex",
    "planner": "codex",
    "reviewer": "claude",
    "builder": "codex",
    "inspector": "claude"
  },
  "repo": "C:\\Users\\jfabi\\Documents\\Projects\\tests\\ngne",
  "plan": "C:\\Users\\jfabi\\Documents\\Projects\\tests\\ngne\\plans\\NGNE-21-webgpu.md",
  "plan_sha256": "cffd1624f790496031d7aacd8415fdfba41b0c67af410ff25e7e85dea617289f",
  "requested_model": "opus",
  "requested_effort": null,
  "base": null,
  "snapshot": null,
  "previous": null,
  "started_at": 1789157097.2620375,
  "artifacts": "C:\\Users\\jfabi\\AppData\\Local\\Temp\\ngne-21-plan-review-20260911\\claudex-vuv6wxym",
  "cli_version": "2.1.269 (Claude Code)",
  "executable": [
    "C:\\Users\\jfabi\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"
  ],
  "exit_code": 0,
  "session_id": "43d70e0b-4c94-4a92-9668-929efbdf4fea",
  "response": {
    "verdict": "REVISE",
    "summary": "The plan mostly holds up against the repository and the pinned v03 source. I checked the affine math against the current GLSL rotation, the UV/Y orientation, the 56-byte layout, the 48-byte uniform, the alpha conversion, the raw-frame readers, the Assets/lease semantics and the BrowserGame lifecycle, and all of them match the plan. Several concrete defects remain: 1) The planned pixel-readback target conflicts with the single preferred-format pipeline. 2) Startup rollback with surviving candidates is left as an either/or. 3) Terminal renderer failure is silent in hello and in any host without a diagnostic. 4) The WebGPU capability error gets wrapped by Game.prepare. 5) The API fixture cannot catch GPU types leaking into the published declarations. 6) Several smaller items: test and fixture updates, image-decode options, cleanup timing, error-scope and missing-texture policy, and the precise Assets retry race.",
    "findings": [
      {
        "id": "F1-readback-format-vs-pipeline",
        "severity": "medium",
        "path": "plans/NGNE-21-webgpu.md",
        "evidence": "'Frame format and rendering' says there is one alpha pipeline for the preferred format (the v03 buildPipeline bakes `targets:[{format}]` into the pipeline). The Verification contract says to 'Prefer the internal encoder boundary with offscreen `rgba8unorm` target' using 'the same production encoder'. On Windows/Chrome, getPreferredCanvasFormat() is normally bgra8unorm. Encoding the production pipeline into an rgba8unorm attachment is a WebGPU validation error: attachment format must match the pipeline target. So the primary pixel proof either fails or needs an undeclared second pipeline.",
        "fix": "Choose one: (a) the offscreen readback target uses the renderer's configured/preferred format, and readback swizzles BGRA→RGBA before comparing; or (b) the internal boundary takes an explicit target format and builds a test-injected pipeline for it. Also state that channel-order swaps are part of what the readback checks."
      },
      {
        "id": "F2-rollback-candidate-registration",
        "severity": "medium",
        "path": "src/browser.ts",
        "evidence": "The plan says cold rollback 'destroys that attempt's renderer'. It also says a surviving candidate must 'remain either usable with a re-established image registration or explicitly released', and to 'Revalidate all live image registrations'. The choice is left open. Concrete case: hello calls `start(await game.prepare(scene))`; the cold preparation created the renderer and registered the image consumer in its texture cache. input.attach then throws (browser.ts:131 runs before Game.start). The rollback destroys the renderer and its cache, but `initial` is still a ready SceneCandidate in Game.preparedScenes (Game.start never consumed it). A retry `start(initial)` creates a new renderer whose cache lacks the image, so the first render reports a missing texture. This is also inconsistent with stop(), which preserves the ready renderer in the same Stopped state.",
        "fix": "Decide explicitly. Recommended: the renderer instance and its texture cache are BrowserGame-owned. Cold-start rollback detaches input and resets start state, but does not destroy a renderer that still has live consumers from outstanding candidates. It destroys only a renderer created by this start attempt that has no consumers. Alternatively, rollback must release every outstanding prepared candidate (documented as a contract change). Add a Node test for input-attach failure followed by a retry start with the same candidate."
      },
      {
        "id": "F3-terminal-failure-silent",
        "severity": "medium",
        "path": "examples/hello/main.ts",
        "evidence": "Acceptance requires an 'explicit terminal rendering failure'. Today BrowserGame routes renderer errors to `(e) => this.game.report(e)` (browser.ts:128-130). Game.report calls `options.diagnostic?.()` and silently drops errors when no diagnostic is given (scene.ts:277-283). hello constructs BrowserGame without a diagnostic. The plan also keeps Game Running, with simulation and audio continuing, while frames skip after terminal recovery failure. Result: a lost device plus a failed recovery leaves a frozen canvas and nothing reported in hello or in any default host.",
        "fix": "Specify a surface that cannot be missed. Either give hello a diagnostic that shows terminal renderer failure in its visible error element, and/or have BrowserGame fall back to console.error when no diagnostic is supplied. Also expose a readable renderer state (for example `failed`), or decide that terminal renderer failure moves the Game to Failed and stops the loop. Test that the failure is visible in hello."
      },
      {
        "id": "F4-capability-error-wrapped",
        "severity": "low",
        "path": "src/scene.ts",
        "evidence": "In phase 3, hello's scene has an imageAsset, so the readiness hook calls ensureRenderer inside Game.prepare. When WebGPU is unavailable, the actionable error is thrown inside the prepare try block, and scene.ts:318-327 rethrows it as `AggregateError([error], \"Scene preparation failed\")`. A visible `String(error)` (the Starfall pattern) would show 'AggregateError: Scene preparation failed' rather than the capability message the acceptance requires.",
        "fix": "Either have hello (and the guide) unwrap AggregateError.errors when showing the message, or have the host check capability (await the shared ensureRenderer) before prepare and surface that error directly. Test the exact user-visible text when WebGPU is unavailable."
      },
      {
        "id": "F5-api-fixture-inherits-webgpu-types",
        "severity": "low",
        "path": "tests/tsconfig.api.json",
        "evidence": "The plan adds explicit @webgpu/types inclusion 'inherited by library/API builds'. tests/tsconfig.api.json extends ../tsconfig.json and compiles api-misuse.ts against the built package. With inherited ambient GPU types, the consumer fixture cannot detect published dist/engine/*.d.ts declarations that reference GPUDevice/GPUTexture etc. @webgpu/types is only a devDependency, so real consumers would fail to type-check (unless they use skipLibCheck).",
        "fix": "Require the public declarations to be free of GPU* identifiers, and compile the API fixture without @webgpu/types (for example override `types` to exclude it). Alternatively, if GPU types are intentionally public, make them a documented peer/runtime typing dependency."
      },
      {
        "id": "F6-lifecycle-teardown-order-assertion",
        "severity": "low",
        "path": "tests/browser-lifecycle-checks.ts",
        "evidence": "Lines 211-233 wrap renderer.dispose and assert `attempted.join() === \"audio,renderer,input\"`, which reflects the current dispose action order (browser.ts:214-220). The plan moves renderer cleanup before Game.dispose/audio, so this check will fail or constrain the new order. It also monkeypatches a synchronous renderer.dispose, which must still work for the WebGPU union. The file is missing from the plan's list of affected tests.",
        "fix": "List this check among the updated browser tests. Assert the new documented order (renderer before Game.dispose), or assert set membership plus the 'renderer before Assets close' invariant, for both renderer paths."
      },
      {
        "id": "F7-float32-center-recovery",
        "severity": "low",
        "path": "tests/interpolation.test.ts",
        "evidence": "Existing readers use exact equality on unsnapped values (interpolation.test.ts:30-31, 50, 59; interpolation-scenario.ts:61-63; ecs-soa.test.ts:414-422). After the change, the stored tx is fround(x - (ix+jx)/2), and the ix/jx products use inexact cos/sin. So a recovered center tx+(ix+jx)/2 is not bit-equal to fround(x) for fractional or rotated cases. The plan says to 'Assert recovered centers' without saying how to compare them.",
        "fix": "Specify the comparison: compute expected packed fields with the same float32 formula (Math.fround per field), or use a declared tolerance (for example 1e-4 px) for unsnapped or rotated cases. Keep exact equality only where values are dyadic, rotation is 0 and the value is snapped."
      },
      {
        "id": "F8-straight-alpha-bitmap-options",
        "severity": "low",
        "path": "src/assets.ts",
        "evidence": "imageAsset calls `createImageBitmap(blob)` with default options (assets.ts:17), and the plan snapshots manual sources with createImageBitmap without specifying options. With the default premultiplyAlpha, the browser may store premultiplied data. copyExternalImageToTexture with premultipliedAlpha:false then un-premultiplies, which loses precision for low-alpha pixels. The plan's semi-transparent straight-alpha pixel test would then need loose tolerances or fail.",
        "fix": "Specify `premultiplyAlpha: \"none\"` and `colorSpaceConversion: \"none\"` (or document the chosen conversion) for imageAsset decoding and the manual snapshot. Set the pixel-test tolerance accordingly."
      },
      {
        "id": "F9-async-cleanup-vs-sync-lease",
        "severity": "low",
        "path": "src/scene.ts",
        "evidence": "The hook 'returns an optional asynchronous idempotent cleanup callback', but Lease.release(), SceneCandidate.release() and the scene Cleanup stack are synchronous and aggregate thrown errors (scene.ts:104-111, primitives.ts:33-48). If the GPU cleanup returns a Promise, composing it into the synchronous release drops its failures as unhandled rejections and breaks the reverse-cleanup/aggregation semantics the plan promises to preserve.",
        "fix": "State that the hook is async but the returned cleanup is synchronous (`() => void`) and idempotent. Any deferred GPU destruction must be handled internally by the renderer (generation-guarded), with failures reported through the renderer diagnostic."
      },
      {
        "id": "F10-missing-texture-policy",
        "severity": "low",
        "path": "src/renderer.ts",
        "evidence": "The legacy renderer throws 'Texture is not uploaded' (renderer.ts:322), which BrowserGame turns into FAIL_GAME (browser.ts:112-116). The plan makes WebGPU render errors diagnostics-only, with 'next valid frame renders'. Only over-limit frames are 'report once per failure episode'. A persistent missing texture would then report at 60 Hz, and the two renderers would handle the same author fault differently without that being documented.",
        "fix": "Define the missing/unready texture policy for WebGPU: skip the frame and report once per episode (keyed by ID) until a valid frame. Document the difference from the legacy fail-game behavior in the contract, or match it deliberately."
      },
      {
        "id": "F11-error-scope-sync-throw",
        "severity": "low",
        "path": "plans/NGNE-21-webgpu.md",
        "evidence": "'Upload' says to push validation/OOM scopes and 'pop scopes synchronously in matching stack order'. copyExternalImageToTexture can throw synchronously (SecurityError for non-origin-clean canvases, InvalidStateError for closed bitmaps, OperationError). Manual HTMLCanvasElement sources make this reachable. A throw between push and pop leaves scopes on the device stack, and later operations' errors are then misattributed or swallowed.",
        "fix": "Require the pops in `finally`, still synchronous and in reverse order, with the synchronous exception taking precedence. Add a failure-injection test that a throwing copy leaves the scope stack balanced."
      },
      {
        "id": "F12-assets-retry-race-description",
        "severity": "low",
        "path": "src/assets.ts",
        "evidence": "assets.ts:63-70 already deletes an entry only when it is still the mapped entry, but only once refs reach zero. The actual gap: when one consumer rejects while another sharing consumer has not yet run its release continuation, an immediate retry (for example prepareCandidateSlot's loop, scene.ts:372-399) acquires the same rejected entry and fails again. The plan's wording ('remove ... only if the map still points at that exact entry') describes existing behaviour, not the fix.",
        "fix": "State the change precisely: on load rejection, remove the entry from the map immediately (identity-guarded) regardless of refs, while existing lease holders keep their refs harmlessly. Add a test where two consumers share a failing load and one retries in the same microtask turn."
      }
    ],
    "coverage": [
      "Read the full plan and its review log (recon only; no prior review rounds recorded).",
      "Repository: src/renderer.ts, src/browser.ts, src/assets.ts, src/scene.ts, src/index.ts, src/input.ts, src/primitives.ts, package.json, tsconfig.json, tsconfig.lib.json, tests/tsconfig.api.json, demo/main.ts, examples/hello/main.ts and scene.ts, examples/platformer/main.ts, docs/contracts/NGNE.md (platform/lifecycle/renderer/assets sections).",
      "Traced raw Frame.data readers across tests/demo/examples via grep. The plan's list matches the actual readers (engine, interpolation, interpolation-scenario, ecs-soa, platformer, browser-interpolation-checks).",
      "Checked browser-lifecycle-checks dispose-order assertions and the browser-validation/interpolation canvas usage.",
      "Pinned v03 source: gpu/quadShader.ts, gpu/QuadBufferLayout.ts, gpu/QuadRenderer.ts, gpu/GpuContext.ts, gpu/createResourceRegistry.ts, assets/TextureAssets.ts.",
      "Verified the affine corner formula against the legacy GLSL column-major rotation and v03 WGSL mat2x2 construction; UV/corner/index order; 56-byte attribute offsets; 48-byte uniform offsets; premultiply-in-shader with one/one-minus-src-alpha blending equivalence to legacy SRC_ALPHA blending on an opaque target; writeBuffer element-count semantics.",
      "Traced Game.prepare/candidate slot/mount/stop/dispose lease flows and BrowserGame start/stop/dispose ordering relative to the proposed readiness hook and renderer lifetime."
    ],
    "limitations": [
      "Could not read the live Jira NGNE-21 description, so fidelity to Jira is judged only through the plan's summary and the review log.",
      "Did not read cluster-renderer .docs (09-decisions D-01–D-34), frame/QuadFrame.ts, or the v03 tests.",
      "Did not read docs/decisions.md, docs/architecture.md, docs/guide.md, docs/verification.md, docs/roadmap.md, tests/benchmark.ts, tests/browser-baseline.ts or tests/api-misuse.ts in full.",
      "WebGPU API behaviour (error-scope capture of queue operations, createImageBitmap premultiplication defaults, any TS lib.dom overlap with @webgpu/types) is judged from knowledge, not from primary docs fetched in this session.",
      "Could not run tests, typecheck, build or browser checks; no claim is made that anything passes. The plan SHA256 was not recomputed."
    ]
  },
  "usage": {
    "input_tokens": 226,
    "cache_creation_input_tokens": 110026,
    "cache_read_input_tokens": 452902,
    "output_tokens": 29412,
    "output_tokens_details": {
      "thinking_tokens": 20871
    },
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 110026,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "not_available",
    "iterations": [
      {
        "input_tokens": 32,
        "output_tokens": 12758,
        "cache_read_input_tokens": 110151,
        "cache_creation_input_tokens": 4112,
        "cache_creation": {
          "ephemeral_5m_input_tokens": 0,
          "ephemeral_1h_input_tokens": 4112
        },
        "type": "message"
      }
    ],
    "speed": "standard"
  },
  "observed_models": [
    "claude-haiku-4-5-20251001",
    "claude-opus-5"
  ],
  "permission_denials": [],
  "total_cost_usd": 2.073814,
  "elapsed_seconds": 380.2
}
```

### Round 1 arbitration and packet restriction

All twelve findings accepted; dispositions are in [round 1 feedback](NGNE-21-round-1-feedback.md). The host chose persistent BrowserGame ownership across recoverable cold-start rollback, explicit failure visibility, preferred-format pixel readback, synchronous cleanup, balanced error scopes, immediate failed-load eviction, and isolated public declaration checks.

Automatic approval review rejected a proposed resumed call because the feedback included a verbatim live Jira description, citing insufficient authorization to export potentially sensitive Jira text to Claude. The rejected command never executed and consumes no review round. Safer alternative: removed the entire raw Jira snapshot from the workspace feedback packet and retained only the authorized host-authored plan and finding dispositions. Reviewer Jira-access limitation remains explicit. No runtime flags or provider were changed.

## Round 2 — APPROVED

The runner resumed the exact successful session 43d70e0b-4c94-4a92-9668-929efbdf4fea. Requested opus, observed claude-opus-5, completed with exit 0 and no permission denials. All twelve prior findings resolved; no new findings. Full result follows.

Result: C:\Users\jfabi\AppData\Local\Temp\ngne-21-plan-review-20260911\claudex-q2yrztts\result.json

```json
{
  "status": "completed",
  "mode": "review",
  "provider": "claude",
  "roles": {
    "host": "codex",
    "planner": "codex",
    "reviewer": "claude",
    "builder": "codex",
    "inspector": "claude"
  },
  "repo": "C:\\Users\\jfabi\\Documents\\Projects\\tests\\ngne",
  "plan": "C:\\Users\\jfabi\\Documents\\Projects\\tests\\ngne\\plans\\NGNE-21-webgpu.md",
  "plan_sha256": "1434e02d24371c1501357a59b7b667b494f8d6afb8fa4d2987ac8afd271f2c5f",
  "requested_model": "opus",
  "requested_effort": null,
  "base": null,
  "snapshot": null,
  "previous": "C:\\Users\\jfabi\\AppData\\Local\\Temp\\ngne-21-plan-review-20260911\\claudex-vuv6wxym\\result.json",
  "started_at": 1789157755.2203372,
  "artifacts": "C:\\Users\\jfabi\\AppData\\Local\\Temp\\ngne-21-plan-review-20260911\\claudex-q2yrztts",
  "cli_version": "2.1.269 (Claude Code)",
  "executable": [
    "C:\\Users\\jfabi\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"
  ],
  "exit_code": 0,
  "session_id": "43d70e0b-4c94-4a92-9668-929efbdf4fea",
  "response": {
    "verdict": "APPROVED",
    "summary": "The revision resolves all twelve round-1 findings, and I found no new material defects. Each disposition matches the revised text. F1: the pixel target uses the configured/preferred format, with BGRA swizzle and nonsymmetric channel checks. F2: there is now an explicit WebGPU ownership rule. The renderer and cache persist across recoverable cold-start rollback, partial initialization is cleaned and can be retried, failed rollback tears down GPU ownership, and the same-candidate retry test is required. F3: renderer.status is public, the console fallback applies when no diagnostic is supplied, and hello shows a persistent visible error. F4: AggregateError is flattened in hello and the guide. F5: the API fixture uses types [] and skipLibCheck false, and public declarations must be free of GPU types. F6: the lifecycle-check update is listed. F7: Float32 expected values and tolerances are specified. F8: explicit createImageBitmap options, with a precision caveat. F9: the hook is async and its cleanup is synchronous. F10: faults are suppressed per episode, and the legacy difference is documented. F11: error scopes are popped in finally, with a regression test. F12: rejected loads are evicted immediately with an identity guard, with a microtask race test. I also checked the new decisions against existing callers. Persistent renderer ownership fits stop's existing preservation, Game.start's cold rollback, the candidate lifecycle and the disposal contract. Eviction on rejection keeps Assets' identity guard and cancellation paths intact. Overriding the API fixture's types does not affect the library build, which inherits the root tsconfig. One cosmetic point, not a defect: the Node-level assertions paragraph sits under the \"Browser execution:\" heading.",
    "findings": [],
    "coverage": [
      "Re-read the full revised plan and verified each round-1 disposition (F1–F12) against its revised wording.",
      "Re-checked the F2 ownership decision against src/browser.ts start/stop/dispose, src/scene.ts Game.start cold rollback, prepare, candidate slots and cancelPending (read in round 1). Retaining a successfully initialized renderer is consistent with stop's preservation and with the unconsumed-candidate lifetime.",
      "Re-checked F12 against src/assets.ts acquire/release/dispose. Identity-guarded eviction on rejection coexists with the existing last-ref abort path and with dispose over entries that have no value.",
      "Re-checked F5 against tsconfig.json, tsconfig.lib.json and tests/tsconfig.api.json inheritance. The fixture override does not affect the library build.",
      "Re-checked F3/F4 against Game.report's swallowing when no diagnostic is set, and against the AggregateError wrapping in Game.prepare (scene.ts:277-283, 318-327)."
    ],
    "limitations": [
      "I relied on repository and v03 source files read in round 1 and did not re-read them this round; the plan's HEAD is unchanged from recon.",
      "I could not access Jira. Fidelity to Jira is judged from the plan and the host feedback.",
      "WebGPU API behaviour (error-scope capture, createImageBitmap option semantics, TS lib/@webgpu/types interaction) is judged from knowledge plus the plan's cited references, not from primary docs fetched this session.",
      "I could not run tests, typecheck, build or browser/hardware checks. Nothing is claimed to pass. I did not recompute the plan SHA256."
    ]
  },
  "usage": {
    "input_tokens": 2,
    "cache_creation_input_tokens": 31398,
    "cache_read_input_tokens": 114263,
    "output_tokens": 3568,
    "output_tokens_details": {
      "thinking_tokens": 2281
    },
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 31398,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "not_available",
    "iterations": [
      {
        "input_tokens": 2,
        "output_tokens": 3568,
        "cache_read_input_tokens": 114263,
        "cache_creation_input_tokens": 31398,
        "cache_creation": {
          "ephemeral_5m_input_tokens": 0,
          "ephemeral_1h_input_tokens": 31398
        },
        "type": "message"
      }
    ],
    "speed": "standard"
  },
  "observed_models": [
    "claude-opus-5"
  ],
  "permission_denials": [],
  "total_cost_usd": 0.46032150000000005,
  "elapsed_seconds": 49.12
}
```

## Final verification and handoff

- Plan approved after 2 of 5 permitted completed review rounds; all twelve round-1 findings resolved. Probe turns and the rejected packet attempt were not counted.
- Exact approved plan: plans/NGNE-21-webgpu.md
- SHA256: 1434e02d24371c1501357a59b7b667b494f8d6afb8fa4d2987ac8afd271f2c5f
- Runner check completed with: Approval matches the current plan.
- Explicit Prettier check passed for the plan and round-1 feedback. The transcript preserves raw runner results append-only and was not reformatted.
- Local plan/feedback links, trailing whitespace, code fences and git diff --check passed. No production source, owning docs, Jira state or git commits were changed.
- Reviewer could not directly access Jira or run proofs/hardware checks. Host checked Jira and cited API references; implementation proof and hardware validation remain future work.
- Cosmetic advice about the placement of a Node-assertion paragraph was left unchanged to preserve the exact approved plan. No unresolved material finding.
- Communication gate verified new-session review, same-session resume, receipt and disposition of feedback, requested/observed Opus identity, structured results, empty permission denials and final hash binding.
- A later build must start from this exact plan, revalidate source/API/hardware assumptions and use fresh Claude Opus implementation inspection. Implementation is not authorized by this planning request.

## Build start - 12 September 2026

All five phases explicitly authorized in the implementation task. No commit, push, publication or Jira writes authorized. Host/builder Codex; inspector fresh Claude Opus (--model opus), inspection enabled. Maximum two fix attempts and two inspection rounds. Approved plan remains unchanged; runner check passed. Pre-build HEAD: 94a70a0393060707908a226c9e2d2107bdbae01c. Initial untracked files: the three supplied plans/NGNE-21 records only. Source HEAD: 34458a987f03b00894e98a40d39fc0ae666194f6; source tree clean and read only. Jira read back unchanged. Initial sandbox Python/Claude execution denied; elevated execution succeeded without changing runner restrictions. CLI 2.1.269. Requested opus, observed claude-opus-5 (plus auxiliary Haiku in first probe). Exact-session resume and token receipt verified; permission denials empty. Probe turns are no-op communication checks, not implementation inspection.


Result: C:\Users\jfabi\AppData\Local\Temp\ngne-21-build-diagnostics-20260912\claudex-8akb4t50\result.json

```json
{
  "status": "completed",
  "mode": "review",
  "provider": "claude",
  "roles": {
    "host": "codex",
    "planner": "codex",
    "reviewer": "claude",
    "builder": "codex",
    "inspector": "claude"
  },
  "repo": "C:\\Users\\jfabi\\AppData\\Local\\Temp\\ngne-21-build-communication-20260912",
  "plan": "C:\\Users\\jfabi\\AppData\\Local\\Temp\\ngne-21-build-communication-20260912\\PLAN.md",
  "plan_sha256": "997452d22e3ecf9e2f3c6e79aa8395d541b1618dbd39809e2c1be3c6de5d970c",
  "requested_model": "opus",
  "requested_effort": null,
  "base": null,
  "snapshot": null,
  "previous": null,
  "started_at": 1789200468.5326126,
  "artifacts": "C:\\Users\\jfabi\\AppData\\Local\\Temp\\ngne-21-build-diagnostics-20260912\\claudex-8akb4t50",
  "cli_version": "2.1.269 (Claude Code)",
  "executable": [
    "C:\\Users\\jfabi\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"
  ],
  "exit_code": 0,
  "session_id": "df355d17-16e5-4eb8-a2f0-dc15489f8f73",
  "response": {
    "verdict": "APPROVED",
    "summary": "Acknowledging token NGNE21-BUILD-20260912. PLAN.md is a read-only no-op communication probe: it proposes no implementation and lists no files to change. The working directory C:\\Users\\jfabi\\AppData\\Local\\Temp\\ngne-21-build-communication-20260912 contains exactly one file (PLAN.md, 2 lines) and is not a git repository, so there is no source, no callers, and no shared state to trace. With no proposed diff, there are no correctness, spec-fidelity, security, or edge-case defects to report. The plan's instruction to echo a token is benign and does not alter the reviewer role; I treated it as evidence, not as a directive to change scope. APPROVED reflects \"no material unresolved defects\" for an empty change set, not a positive assessment of any implementation.",
    "findings": [],
    "coverage": [
      "Read PLAN.md in full (2 lines); content matches the plan text supplied in the prompt — a read-only no-op probe requesting token acknowledgment only.",
      "Enumerated the entire working directory via glob **/* : PLAN.md is the only file. No source, config, test, or build files exist to review.",
      "Confirmed environment reports the directory is not a git repository, so there is no branch diff, history, or prior revision to compare against.",
      "Checked for a proposed change set: the plan explicitly states there are no files to change, and none were found; therefore no callers or writers of shared state exist to trace."
    ],
    "limitations": [
      "No implementation artifacts exist in this workspace, so this review cannot attest to the correctness of any code; it only confirms the probe's premise (empty change set) is accurate.",
      "Not a git repository, so I could not inspect a diff, branch, or commit history to verify that nothing was changed outside the stated scope.",
      "Per role constraints I did not run tests or builds and make no claim about test results.",
      "If the real change set lives outside this temp directory, it was not visible to me and remains unreviewed; a re-review against the actual repository would be required."
    ]
  },
  "usage": {
    "input_tokens": 34,
    "cache_creation_input_tokens": 5930,
    "cache_read_input_tokens": 5582,
    "output_tokens": 1089,
    "output_tokens_details": {
      "thinking_tokens": 139
    },
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 5930,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "not_available",
    "iterations": [
      {
        "input_tokens": 32,
        "output_tokens": 931,
        "cache_read_input_tokens": 5582,
        "cache_creation_input_tokens": 348,
        "cache_creation": {
          "ephemeral_5m_input_tokens": 0,
          "ephemeral_1h_input_tokens": 348
        },
        "type": "message"
      }
    ],
    "speed": "standard"
  },
  "observed_models": [
    "claude-haiku-4-5-20251001",
    "claude-opus-5"
  ],
  "permission_denials": [],
  "total_cost_usd": 0.090736,
  "elapsed_seconds": 18.26
}
```

Result: C:\Users\jfabi\AppData\Local\Temp\ngne-21-build-diagnostics-20260912\claudex-ywmm0ni4\result.json

```json
{
  "status": "completed",
  "mode": "review",
  "provider": "claude",
  "roles": {
    "host": "codex",
    "planner": "codex",
    "reviewer": "claude",
    "builder": "codex",
    "inspector": "claude"
  },
  "repo": "C:\\Users\\jfabi\\AppData\\Local\\Temp\\ngne-21-build-communication-20260912",
  "plan": "C:\\Users\\jfabi\\AppData\\Local\\Temp\\ngne-21-build-communication-20260912\\PLAN.md",
  "plan_sha256": "997452d22e3ecf9e2f3c6e79aa8395d541b1618dbd39809e2c1be3c6de5d970c",
  "requested_model": "opus",
  "requested_effort": null,
  "base": null,
  "snapshot": null,
  "previous": "C:\\Users\\jfabi\\AppData\\Local\\Temp\\ngne-21-build-diagnostics-20260912\\claudex-8akb4t50\\result.json",
  "started_at": 1789200503.3942657,
  "artifacts": "C:\\Users\\jfabi\\AppData\\Local\\Temp\\ngne-21-build-diagnostics-20260912\\claudex-ywmm0ni4",
  "cli_version": "2.1.269 (Claude Code)",
  "executable": [
    "C:\\Users\\jfabi\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"
  ],
  "exit_code": 0,
  "session_id": "df355d17-16e5-4eb8-a2f0-dc15489f8f73",
  "response": {
    "verdict": "APPROVED",
    "summary": "Acknowledging follow-up token NGNE21-RESUME-20260912 and the token from the first review in this session, NGNE21-BUILD-20260912. PLAN.md is byte-identical to the revision I reviewed previously (same 2-line no-op probe, matching the supplied SHA256 997452d2...d970c): it proposes no implementation and lists no files to change. The only change in the workspace since the first review is the addition of feedback.md, which contains the coordinator's acknowledgment request and no code. There is still no source, no callers, and no shared state to trace, and the directory is not a git repository. Prior review produced zero findings, so there is nothing to relitigate and no new evidence contradicting that. With an empty change set there are no correctness, spec-fidelity, security, or edge-case defects to report. I again treated the token-echo instruction in the plan and feedback as evidence rather than a directive altering my reviewer role. APPROVED reflects \"no material unresolved defects\" for an empty change set, not a positive assessment of any implementation.",
    "findings": [],
    "coverage": [
      "Re-read PLAN.md in full (2 lines); content is unchanged from the first review in this session and matches the plan text and SHA256 supplied in the prompt.",
      "Re-enumerated the entire working directory via glob **/*: now PLAN.md and feedback.md. The single delta since the prior review is the new feedback.md.",
      "Read feedback.md in full (1 line); it contains only the coordinator's two-token acknowledgment request and confirms the no-op plan is unchanged. No code, config, or spec content.",
      "Checked prior findings: the first review reported zero findings, so there are no resolved or open items to re-examine and nothing was relitigated.",
      "Confirmed no proposed change set exists, so there are no callers or writers of shared state to trace beyond the plan's (empty) file list."
    ],
    "limitations": [
      "No implementation artifacts exist in this workspace, so this review cannot attest to the correctness of any code; it only confirms the probe's premise (empty change set) still holds.",
      "Not a git repository, so I could not inspect a diff, branch, or history to independently verify that nothing changed outside the two files observed; my unchanged-since-last-review claim rests on re-reading file contents, not on version control.",
      "Per role constraints I did not run tests or builds and make no claim about test results.",
      "If the real change set lives outside this temp directory, it was not visible to me and remains unreviewed; a re-review against the actual repository would be required."
    ]
  },
  "usage": {
    "input_tokens": 6,
    "cache_creation_input_tokens": 2167,
    "cache_read_input_tokens": 21282,
    "output_tokens": 1293,
    "output_tokens_details": {
      "thinking_tokens": 46
    },
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 2167,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "not_available",
    "iterations": [
      {
        "input_tokens": 2,
        "output_tokens": 1018,
        "cache_read_input_tokens": 7857,
        "cache_creation_input_tokens": 240,
        "cache_creation": {
          "ephemeral_5m_input_tokens": 0,
          "ephemeral_1h_input_tokens": 240
        },
        "type": "message"
      }
    ],
    "speed": "standard"
  },
  "observed_models": [
    "claude-opus-5"
  ],
  "permission_denials": [],
  "total_cost_usd": 0.064666,
  "elapsed_seconds": 19.1
}
```

## Phase 1 checkpoint

Baseline Node suite: 108/108; typecheck and format check passed. Baseline build required elevated execution because sandbox esbuild could not read a parent directory; elevated build passed. CPU benchmark completed; raw repeat preserved under the build diagnostics directory. Source and Jira were reverified. @webgpu/types 0.1.72 queried from npm and pinned.

Adapted the specified v03 modules and constants, shared 14-float Frame, and legacy affine shader/layout. Updated raw readers now because existing-suite acceptance at this gate requires them. Three independent layout/affine/growth tests passed; existing 108 tests passed after packing change; elevated build passed. Real in-app Chromium 152 on Windows acquired Intel gen-12lp, non-fallback, bgra8unorm, DPR 1, secure localhost, maxBufferSize 268435456 and maxTextureDimension2D 8192. Production encoder rendered exact RGBA 224,64,32,255 and 32,64,224,255 into a preferred-format target; real canvas path reported two runs. Full existing browser validation completed ALL CHECKS PASSED with no console warnings/errors. This is core hardware rendering evidence, not recovery or complete image readiness evidence. Phase 2 begins; final inspection not yet run.


## Phase 2 checkpoint

Expanded real Intel WebGPU checks passed: A/B/A remains three runs; sorted translucent overlap, empty clear, 10,000 sprites, active-range upload size, reused grown buffers, rotated UV quadrants, signed geometry, decoded-source alpha times sprite alpha, and 65 interpolation transition/alpha samples. Both legacy games started through their existing WebGL path. Mock tests additionally prove frame-fault suppression/reset, corrected-frame rendering, bounded growth/destruction and registry handles beyond 65535. No physical driver loss claim.

## Phase 3 checkpoint

ImageAsset marker, decoded-source retention, internal asynchronous preparation hook, synchronous idempotent cleanup, explicit WebGPU host selection and lifecycle integration implemented. Built package consumer fixture passes with types [] and skipLibCheck false. Node suite 121/121 after initial image tests; three subsequent focused frame/registry tests also pass. Ten focused image tests include shared load immediate retry before the second release continuation, cancellation, manual transactional replacement, and disposal at five async boundaries. Hello uses a PNG fixture because real createImageBitmap rejected the initial SVG fixture; PNG loads successfully and capability errors remain visible. Full browser page again completed ALL CHECKS PASSED after exercising both lifecycle paths, shared image setup, input-attach rollback/same-candidate retry, Game.start rollback/fresh preparation with another live candidate, stop/resume, backing restoration, renderer-before-Assets teardown, real-device synchronous-copy scope recovery and exact hello capability text in an isolated iframe. Test adjustments reflect asynchronous cold acquisition; cold disposal may precede any scheduler callback. Phase 4 begins.


## Phase 4 checkpoint

Seven focused recovery mocks pass: successful reconstruction with retained leased/manual IDs, stale callbacks, adapter denial, replacement loss, reupload failure, initially lost acquisition, membership churn and disposal while replacement is pending. Each failure is bounded and terminal where required. Real Intel WebGPU controlled device.destroy test acquired a replacement device and restored exact leased/manual RGBA canvas pixels (192,64,128,255); rendering skipped during recovery. Successful recovery kept consumers and emitted no validation diagnostics. An isolated real hello fixture denied the replacement adapter after controlled loss and verified its persistent exact recovery-failed/reload message. Full validation finished ALL CHECKS PASSED. These are controlled loss/failure-injection results, not physical GPU/driver loss or portability proof. Phase 5 measurement, final documentation and fresh Opus inspection remain.


## Build continuation - 12 September 2026 (Claude Code)

Codex reached its usage limit after the phase 4 checkpoint and most phase 5 measurement/documentation; no final inspection had run. The user asked Claude Code (Opus 5) to finish the build. The claudex runner requires Codex as host, so the fresh inspection used a read-only Claude Opus subagent in Claude Code (no edits, state-changing git or formatting) against this exact plan and pre-build HEAD 94a70a0. Approved plan unchanged.

Resumed state: Node 133/133, typecheck and build passed; format:check failed on docs/verification.md; Codex had recorded a 22.5% Chaos CPU median regression.

- Regression: same-session A/B isolated it to `Frame.add` bytecode growth (423 → 514 bytes, above V8's 460 inline limit); raising the V8 limit, or the old code with a 14-float stride, measured at pre-build speed. Extracting `packAffine` and `grow()` gives 363 bytes and 0.737–0.749 ms triples vs pre-build 0.747–0.766 ms. Values unchanged. Raw: final-bench-inlining-fix.txt.

### Inspection round 1 - REVISE

One medium, five low findings:

1. Medium: hello/guide diagnostic replaced its alert with any report, including non-Error overload records, so the terminal recovery message was not persistent. Fixed: ignore non-Error values, append distinct flattened messages; browser check rechecks after 500 ms; contract updated.
2. Low: a failed consumer could evict a shared published image; loss between readiness and generation read threw instead of joining recovery. Fixed: `continue` on missing generation in acquire/texture; evict only unpublished entries.
3. Low: host hook released a source lease already owned by the renderer. Fixed: release only when renderer acquisition/abort fails.
4. Low: uncaptured errors reported per frame; growth allocation unvalidated. Fixed: once per message per device; OOM-scoped growth lowers later capacity or skips with episode suppression; new Node test.
5. Low: legacy WebGL teardown/rollback changed beyond the plan. Fixed: gated to WebGPU.
6. Low: some focused-test rows proven only indirectly (host hook lease counts, image candidate refill, enumerate() identity absence, loss during replacement awaits). Accepted as recorded limits.

### Inspection round 2 - APPROVED

Same inspector session resumed with host dispositions; all findings resolved or accepted as limits, no new material findings. Non-blocking: a deterministic Node race test for finding 2 is feasible but not added; lowered growth cap persists for the device generation (documented in contract).

### Final proofs

npm.cmd test 134/134, typecheck, build, format:check and git diff --check passed. validation.html in in-app Chromium 152.0.7977.76, Intel gen-12lp, secure localhost: 182 PASS, 0 FAIL, 0 SKIP, ALL CHECKS PASSED, no console errors. Hello renders via WebGPU; platformer and Starfall start on WebGL. Sustained browser renderer and Starfall samples predate the CPU inlining fix and were not rerun (headful Chrome, ~10 minutes). No commit, push, publication or Jira write.
