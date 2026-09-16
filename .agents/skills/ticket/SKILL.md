---
name: ticket
description: Draft consistent, execution-ready Jira tickets for manual entry, with concrete acceptance criteria, validation, dependencies, documentation, and completion handoff.
---

# Jira ticket drafts

Create self-contained Markdown ticket drafts that the user can enter and manage in
Jira without relying on the originating conversation.

## Drafting

- Do not access Jira or any external issue tracker. The user owns all Jira creation,
  updates, transitions, and duplicate checks.
- Inspect current repository code, tests, and authoritative documentation before
  drafting. Distinguish verified facts from assumptions and missing evidence.
- Give each ticket one concrete outcome. Keep implementation choices open unless
  an authoritative contract or verified root cause requires them.
- Use repository-relative paths, never machine-specific paths.
- Do not invent project metadata, ticket keys, issue types, priorities, parents,
  assignees, dates, estimates, or versions. Include them only when the user supplies
  them.
- Read and follow [the ticket format](references/ticket-format.md).
- Return the complete copy-ready draft and list only assumptions or missing input
  that materially affect it. Never implement or close the underlying work.
