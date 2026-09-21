---
name: docs-audit
description: Audit project documentation against repository rules and propose a copy-ready Jira cleanup ticket without editing files. Use only when explicitly invoked; an additional prompt is optional.
---

# Documentation audit and ticket draft

Run only when the user explicitly invokes this skill. Invocation alone is sufficient:
with no additional prompt, audit all documentation under `docs/` against the current
`RULES.md`, especially **Documentation and completion**. An optional prompt may narrow
paths or specify a focus; retain the audit-and-draft outcome unless the user limits it.

## Read-only boundary

- Do not create, edit, format, delete, stage or commit files, including reports and
  ticket drafts. Do not implement the proposed cleanup.
- Do not access Jira or another issue tracker. The user owns ticket creation and
  subsequent work tracking.
- Use read-only checks. Do not run builds, installations, generators or unrelated
  runtime suites for this documentation audit.

## Audit

1. Read applicable repository instructions and current `RULES.md`. Inventory the
   requested documentation and classify authoritative docs, usage/examples,
   proposals and historical evidence. Read linked files outside the scope only
   where needed to verify ownership or references.
2. Assess compliance with current `RULES.md`. Do not reuse previous findings without
   verifying that they still apply.
3. Distinguish helpful summaries and examples from competing specifications. The
   contract index owns navigation/public exports. Consumer details belong with the
   consumer.
   Verify the destination before proposing removal of unique information.
4. Keep `docs/evidence/` when it is explicitly historical and non-authoritative,
   with recorded revision/environment provenance and limits. Its location alone is
   not a violation. If unclear, propose classification and an index rather than
   deletion. Preserve existing machine manifests, archives, artifact bytes and
   hashes; distinguish prose clarification from re-running validation. Current
   rules take precedence if they explicitly require another arrangement.
5. Check local file links, heading anchors and relevant inbound references. Search
   scoped text for prohibited tracker references. State any archive, external-link
   or other inspection limits; do not claim checks that were not performed.
6. Spot-check relevant implementation, exports and existing tests before drafting
   concrete semantic claims. Distinguish source/test inspection from executed
   validation. Treat any implementation/documentation contradiction as an unresolved
   finding, not permission to change the contract. Same-task update compliance
   requires change-history evidence; otherwise mark it unassessed.

## Proposed cleanup

For confirmed findings, propose a bounded cleanup preserving every condition,
exception, default, ordering guarantee, ownership boundary and limitation:

- Establish owners and a temporary old-section-to-new-owner review checklist for
  the future implementation task, outside authoritative documentation.
- Relocate semantics before simplifying wording; replace displaced detail with
  concise summaries and direct links.
- Validate semantic preservation, links/anchors, changed-file formatting and the diff.

Default to one ticket for a cohesive documentation-only outcome. Propose a breakdown
only when verified independent work or dependencies warrant it. Record behavioral
contradictions as separate follow-up decisions rather than absorbing implementation
fixes.

## Response

Lead with concise, prioritized findings, each tied to an observed location and the
relevant rule. Separate violations from optional improvements and list checks and
material limits. Use repository-relative paths in the copy-ready draft.

Then provide the complete self-contained Jira draft using the local
[ticket format](../ticket/references/ticket-format.md). Read that reference before
drafting and follow its requirements. Include preservation of semantics and
historical evidence.

If no actionable noncompliance is found, report that result and checks without
manufacturing a cleanup ticket. State only assumptions or missing input that
materially affect the findings or proposed work. Never describe the proposal as
implemented or the ticket as created.
