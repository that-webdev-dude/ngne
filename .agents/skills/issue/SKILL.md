---
name: issue
description: Draft execution-ready GitHub issues and publish them when requested. Use when the user invokes Issue or asks for GitHub issue drafting or creation; not for implementing the underlying work.
---

# GitHub issues

Create self-contained Markdown issues that can be executed without the originating
conversation. Adapted from the repository's ticket drafting skill.

## Drafting

- Inspect current code, tests, and authoritative documentation relevant to the work.
  Distinguish reproduced behavior, source inference, assumptions, and missing evidence.
- Give each issue one concrete outcome. Keep implementation choices open unless a
  contract or verified root cause requires them. Do not expand a small task into an epic.
- Use verified repository-relative paths, never machine-specific paths.
- Do not invent issue numbers, labels, priorities, parents, assignees, milestones,
  dates, estimates, or versions. Include supplied or explicitly requested metadata only.
- Use the format below, keeping sections short and omitting those that genuinely
  do not apply. Scale validation to the actual change; do not invent measurement
  campaigns, frameworks, or additional acceptance gates.
- Never implement or close the underlying work as part of drafting or creation.

## Output format

Provide a literal, descriptive title separately from the Markdown body. Use this
body section order:

### Context

State the current behavior or gap, its impact, and the intended outcome. Identify
the evidence as reproduced behavior, source inference, or missing coverage.

### Relevant code and documentation

List verified repository-relative entry points and explain each file's role.

### Required work

Describe the bounded outcome and important invariants. Do not prescribe an
unverified API or speculative framework.

### Acceptance criteria

Use observable unchecked checklist items (`- [ ]`) covering success, relevant
failure paths, and regression preservation.

### Validation

Name applicable tests, commands, artifacts, and browser, device, or manual checks.
Distinguish deterministic checks from environment-specific evidence.

### Dependencies and scope

Name real prerequisites, independent work, and important exclusions. Reference
existing issues by verified number or URL when relevant.

### Documentation

Name the owning document required by repository rules, or state why documentation
is unaffected.

### Completion handoff

Request a concise completion comment with changed paths or PR links, validation
results, documentation status, remaining limits, and concrete blockers. Link
existing evidence rather than duplicate it.

## Delivery

- For a draft request, return the complete copy-ready title and body, plus only
  assumptions or missing input that materially affect them. Do not publish.
- For an explicit creation request, use the requested repository or the verified
  Git remote. Search for matching issues before creating; do not silently edit a
  duplicate. Existing authorization to create is sufficient; do not ask again.
- Prefer the GitHub connector. Use an authenticated `gh` CLI if the connector is
  unavailable. With the CLI, pass multiline Markdown through `--body-file`.
- If access fails, report the exact blocker. Do not silently switch to browser
  interaction; use it only when requested. After an ambiguous create response,
  check whether the issue exists before retrying to avoid duplicates.
- Verify the returned issue title, body, repository, and URL. Return the issue link
  with a short scope summary. Keep tracker history in GitHub; do not mirror it to
  Jira or add repository reports unless requested.
