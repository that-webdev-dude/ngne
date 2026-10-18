---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up. Only use when the user explicitly invokes /handoff.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
x-source: skills-manager@494c2f9
x-content-hash: ffd83a7f7e25f98dfc4dc4bfaababcc4d7bb64a84a0da9de957cfca9caddd3e8
---
<!-- Vendored from skills-manager@494c2f9. Do not edit here: edit the source in the skills-manager repo and re-run `skills sync`. -->


Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
