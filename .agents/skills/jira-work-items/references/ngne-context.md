# NGNE repository context

This is a starting map, not a status record. Read the current files before authoring a ticket.

- `docs/architecture.md`: authoritative ownership, execution order and lifecycle model.
- `docs/capabilities.md`: required capabilities and explicit deferrals.
- `docs/decisions.md`: architectural reasoning and accepted decisions.
- `docs/contracts/NGNE.md`: current implementation/API contract.
- `docs/roadmap.md`: implementation status and historical dependency plan.
- `docs/verification.md`: dated checks, measurements and limitations.
- `README.md`, `examples/hello/`: engine authoring and consumption guidance.
- `src/`: engine implementation; `demo/`: Starfall showcase and game-owned rules.
- `tests/`: headless, benchmark and browser-validation sources; `validation.html`: local browser checks.
- `.github/workflows/ci.yml`: existing automation; inspect before proposing new CI.
- Historical prototype: `prototypes/ngne/v00/` was removed in NGNE-18. Recover it through Git (`git checkout 1c8a76b -- prototypes/` or `git show 1c8a76b:prototypes/ngne/v00/...`) instead of requiring a working copy; do not rewrite that history.

Public API ergonomics, predictable ownership and measured busy-screen performance matter. Genre mechanics such as platformer controllers and collision rules are game-owned. A second-genre example validates shared engine primitives; it does not authorize a universal physics engine, editor, networking, multiplayer or save/replay implementation.

Jira project name/key, cloud ID, issue types and permissions must be resolved live. Do not store credentials or assume creation rights from a past read-only check.
