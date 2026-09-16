---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up. Only use when the user explicitly invokes Handoff or directly asks for a handoff document.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
x-source: skills-manager@05df4bc
x-content-hash: 31d74387985c51ec0849b3314396e797d1af9195eb6ec03ec9787aab09e180b5
---
<!-- Vendored from skills-manager@05df4bc. Do not edit here: edit the source in the skills-manager repo and re-run `skills sync`. -->


Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
