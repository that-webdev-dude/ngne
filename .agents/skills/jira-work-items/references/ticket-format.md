# Ticket format

Use this section order. Omit a section only when it genuinely does not apply.

Begin each ticket with a literal, descriptive title. Include Jira metadata only when
the user supplies it; otherwise leave it out of the draft.

## Context

State the current behavior or gap, its impact, and the intended outcome. Identify
whether the evidence is reproduced behavior, source inference, or missing coverage.

## Relevant code and documentation

List verified repository-relative entry points and explain each file's role.

## Required work

Describe the bounded outcome and important invariants. Do not prescribe an
unverified API or speculative framework.

## Acceptance criteria

Use observable unchecked checklist items covering success, relevant failure paths,
and regression preservation.

## Validation

Name the required tests, commands, artifacts, and browser, device, or manual checks.
Distinguish deterministic checks from environment-specific evidence.

## Dependencies and scope

Name real prerequisites, independent work, and important exclusions.

## Documentation

Name the owning document required by the repository rules, or state why documentation
is unaffected.

## Completion handoff

Require changed paths or PR links, validation results, documentation status, remaining
limits, and concrete blockers.
