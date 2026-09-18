---
name: ticket
description: Draft consistent, execution-ready Jira tickets for manual entry. Only use when the user explicitly invokes Ticket or directly asks for copy-ready Jira ticket drafts; do not use for ordinary implementation work or live Jira operations.
disable-model-invocation: true
x-source: skills-manager@08a3835
x-content-hash: bc6a5df78767178d19e982bc0792b45aa23c3fa875724e5307d2a5f4cfcfe319
---
<!-- Vendored from skills-manager@08a3835. Do not edit here: edit the source in the skills-manager repo and re-run `skills sync`. -->


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
