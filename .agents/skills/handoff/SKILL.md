---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up. Only use when the user explicitly invokes Handoff or directly asks for a handoff document.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
x-source: skills-manager@08a3835
x-content-hash: 6456533bbc293eb7ee0436953e2272e843d2aa72e7c965513b074760b85e08a2
---
<!-- Vendored from skills-manager@08a3835. Do not edit here: edit the source in the skills-manager repo and re-run `skills sync`. -->


Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
