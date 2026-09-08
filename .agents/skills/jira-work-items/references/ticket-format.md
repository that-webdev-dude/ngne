# Ticket format

Use literal, descriptive titles. Set Jira issue type, priority and parent through verified metadata; the description must remain understandable independently of those fields.

## Context

Explain the current behavior, observed limitation or validation gap, its consequence, and the intended result. State whether a defect is reproduced, a concern is inferred from code, or coverage is missing. Include prior fixes that must be preserved. Do not depend on phrases such as "as discussed" or "the previous task".

## Relevant code and documentation

List the specific repository-relative source files, tests and authoritative documents a contributor should start with. Explain each file's role. Link verified related tickets if they exist. Do not paste an entire repository inventory.

## Required work

Describe the bounded changes or investigation steps, significant cases and existing invariants. Say what success changes for an author or player. Include necessary exclusions and ownership boundaries; avoid prescribing an unproven API or speculative framework.

## Acceptance criteria

Use unchecked Markdown checklist items. Each criterion must be observable in behavior, typechecking, tests or a reviewable artifact. Cover success, relevant failure/cancellation paths and regression preservation. Avoid vague items such as "performant", "fully tested" or "docs updated" without specific evidence.

## Validation

Name relevant existing tests, new scenarios, commands and any required device/manual checks. Distinguish deterministic tests from actual browser/hardware evidence. For investigation work, specify the experiment and decision artifact rather than promising an implementation regardless of findings.

## Dependencies and scope

Name real prerequisite outcomes using ticket keys when known. Explain which portions can begin independently. A relation is not necessarily a blocker. Identify important out-of-scope work when it prevents foreseeable expansion.

## Documentation required before completion

Name the owning document for each fact the work changes, and only that document:

- Ownership rules, exact public behavior, failure semantics and migration: `docs/contracts/NGNE.md`.
- Rationale for a changed or new rule: `docs/decisions.md`. Resolve a genuine contract change before implementing divergent behavior; do not rewrite the architecture to excuse an accidental implementation.
- Authoring usage and runnable samples: `docs/guide.md` and `examples/`.
- Actual commands, hardware/browser context, results and remaining limits: `docs/verification.md`.
- Status and direction: `docs/roadmap.md`.

Other documents link to the owning one instead of repeating the fact. Documentation changes belong with the implementation or evidence-producing change, not in an untracked later task. A task cannot be complete while its owning documentation contradicts its result. Preserve historical evidence as history.

## Completion handoff

Require changed paths or PR links, tests run and results, documentation updated (or justified as unaffected), and remaining limitations. If acceptance criteria cannot be met, leave the task incomplete and identify the concrete blocker.
