---
name: jira-work-items
description: Draft and create execution-ready Jira work items from an approved repository backlog, with concrete acceptance criteria, validation, dependencies, and documentation completion requirements. Use for Jira ticket authoring and backlog creation; it does not authorize implementing or closing the work.
---

# Jira work items

Turn a scoped backlog into tickets another contributor can execute without reading the originating conversation. Use the connected Jira tools (prefer Atlassian Rovo when available); no credentials or account identifiers belong in this skill.

## Establish scope and approval

- Read the user's backlog, constraints, and previous approvals. Preserve the requested number and scope of items; separate confirmed defects from investigation and validation work.
- When the user asks to validate an example before creation, present one representative, fully written ticket using [the ticket format](references/ticket-format.md), then wait for their answer. Do not create even an epic before that approval.
- Existing approval carries forward. A validated example plus authorization to create the backlog is sufficient; do not ask again for every ticket. Skill installation or a request to draft alone does not authorize Jira mutations.
- If the user changes the scope materially, finish unaffected drafting and clarify only the unresolved change before creating affected items.

## Ground the tickets

1. Verify the Jira site and project through connected tools. Read existing issues, with pagination, to avoid duplicating work. Inspect issue types and field metadata before assigning priority, parents or custom fields; never invent IDs.
2. Inspect current repository code, tests, authoritative docs and verification records. Confirm paths exist. Previously fixed defects belong in regression coverage, not automatically in a new bug ticket. Date historical measurements and distinguish them from fresh checks.
3. Identify one concrete outcome per ticket. Keep implementation choices open unless a contract or verified root cause requires them. Do not make game-specific behavior an engine requirement merely because a showcase needed it.
4. Draft the full batch before sending mutations. Use repository-relative paths with purpose descriptions or verified repository links, never machine-specific paths in Jira.

## Write actionable descriptions

Read [references/ticket-format.md](references/ticket-format.md) and use its structure. Scale detail to the task, but retain context, relevant entry points, required work, objective acceptance checks, validation, documentation obligations, and completion handoff. Include genuine dependencies; distinguish hard blockers from related work or coordination.

Every ticket must identify the relevant documentation by path and the behavior/evidence to update. The same change must update affected docs before the task is complete. If a listed conditional update is unnecessary, the completion handoff must explain why. Updating a verification record does not mean claiming checks that were not run. Preserve immutable historical audits and prototype snapshots; update current contracts and evidence instead.

For this repository, consult [references/ngne-context.md](references/ngne-context.md) when creating NGNE work. Recheck its paths and current project metadata rather than treating this reference as a live status report.

## Create and verify

- Epics are optional. Use one or a few only when they give a meaningful completion boundary. Honor the user's grouping preference and verify the project's supported parent field. Never confuse epic membership with a dependency link.
- Create approved items sequentially, recording returned keys immediately. Use structured description fields so Markdown and newlines survive. Do not invent assignees, deadlines, estimates, release versions, or unsupported priorities.
- If a create response is ambiguous or times out, query Jira for that exact intended item before any retry. An empty search alone may reflect indexing delay: inspect available direct results and stop that item's mutation if its outcome remains uncertain. Never blindly retry a batch.
- On partial failure, keep confirmed items, report their keys and the remaining work, and continue only where independent work is safe. Do not delete successful tickets to simulate rollback.
- Read back every created item, including descriptions and intended parent/priority fields, using pagination as needed. Check that required sections and task-specific details survived. Correct authorized field omissions without creating replacement duplicates.
- Return the epic/backlog link, created item count, and any unresolved limitations. Creating tickets does not complete their underlying work; do not mark them done.
