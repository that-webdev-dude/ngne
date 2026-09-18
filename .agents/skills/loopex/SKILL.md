---
name: loopex
description: Implement a task with one persistent independent reviewer and user checkpoints between review rounds. Use when the user requests a writer/reviewer build-and-review workflow with a chosen reviewer model and a maximum round count; not for unattended iteration or a standalone code review.
disable-model-invocation: true
x-source: skills-manager@08a3835
x-content-hash: 939e7b5821e95cdf82b9dcfd2ae5647dc9f04412bc904f09d260388cc233d6fa
---
<!-- Vendored from skills-manager@08a3835. Do not edit here: edit the source in the skills-manager repo and re-run `skills sync`. -->


# Loopex

Use two actors: the current agent is the writer; one independent subagent is the
reviewer. Keep both throughout the run. The writer owns implementation, validation,
finding assessment and user communication. The reviewer inspects and reports; it
never edits the implementation.

## Inputs and round counting

Resolve these inputs before implementation or reviewer dispatch:

- Task: prompt, approved plan, ticket or other concrete scope and acceptance criteria.
- Reviewer model: required user choice. Resolve names such as Astra or Sol against
  the models advertised by the active agent tool. Do not silently substitute models.
- Reviewer reasoning effort: optional. Validate a supplied effort against that
  model's supported values. If omitted, omit the override and report that the
  runtime's default/inheritance rules apply; do not invent an effort setting.
- Maximum rounds: required positive integer. Round 1 includes initial implementation
  and its first review. Each later round includes approved fixes and another review.
  This is a ceiling, not permission to execute rounds automatically.

Ask one bundled question for missing required inputs or unsupported selections.
The current writer remains in place; selecting a reviewer does not change the writer.
A plan-only task does not authorize implementation. Resolve that boundary first.

## Preserve continuity

Keep a compact run record in an existing suitable local evidence directory or a
run-specific temporary directory, outside tracked deliverables unless requested.
Record its location at checkpoints. Do not change repository ignore rules to store it.
Include:

- Task/scope, acceptance criteria and original comparison base.
- Writer context, selected reviewer model and supplied effort (or omitted override).
- Maximum rounds, current round and phase.
- Reviewer agent ID returned at first dispatch; never invent it.
- Reviewed snapshot identity (revision plus diff/content hashes for uncommitted files).
- Validation results and limits, review findings, writer dispositions and proposed fixes.
- The user's checkpoint decision and the exact scope it authorized, when received.

Use phases: ready, implementing, reviewing, assessing, awaiting-user, complete,
limit-reached or blocked. A saved record supports continuity; it does not recreate
an unavailable agent. After context compaction, consult the record before acting.
Never infer checkpoint approval from elapsed time, a restart or the initial round cap.

## One round

1. **Implement.** In round 1, complete the authorized task. In later rounds, apply
   only the accepted fixes authorized at the preceding checkpoint, including explicit
   user corrections. Preserve unrelated changes and run checks appropriate to the diff.
2. **Freeze the review target.** Record the original base, current diff including new
   files, source/artifact identities, acceptance criteria and validation evidence.
   Do not edit the target while review is running. If it changes externally, mark the
   review stale and stop for direction; do not present it as covering the new snapshot.
3. **Dispatch independently.** Only now spawn the reviewer, and only on the first
   round. Use fresh context rather than a full writer-history fork. Supply the task,
   constraints, repository instructions, snapshot and evidence locations, but not a
   desired verdict. Use the chosen model and supplied effort explicitly where supported.
   Save the returned reviewer ID immediately. Keep the reviewer alive between rounds.
4. **Review.** Request read-only inspection of correctness, scope, contracts, regressions,
   relevant tests and evidence. Ask for findings with stable IDs, severity, locations,
   rationale and suggested remedies; distinguish optional suggestions and limitations.
   A reviewer can return no findings. Findings are advice, not authority to edit.
5. **Assess.** The writer independently checks every finding and suggestion against
   source, requirements and evidence. Mark each accepted or rejected with a concise
   reason. If unresolved, label it unresolved and state the missing evidence or decision.
   Do not reject valid concerns merely to obtain a clean review. Do not apply fixes yet.
6. **Checkpoint and end the turn.** Report the round count, changes, checks/limits,
   reviewer findings, each disposition and the concrete fixes proposed for the next
   round. Save phase awaiting-user (or the terminal status below), then STOP.
   Do not dispatch another review or make review-driven changes before the user's reply.

A reviewer may run appropriate non-mutating checks; generated test artifacts belong
in normal local output locations. Neither actor may start other implementation agents
or additional reviewers as part of this two-actor workflow.

## Continuing after a checkpoint

An explicit continuation such as "go ahead" authorizes one next round, covering the
presented accepted fixes and their validation/review, provided the round cap permits.
It does not authorize all remaining rounds. Acknowledgements, status questions and
requests to explain a finding are not approval to continue.

Increment the round when that approved next round begins. Reuse the saved reviewer
ID through the runtime's continuation/follow-up operation; do not spawn a fresh reviewer.
Send the new snapshot, changes since the last review, prior finding dispositions and
validation. Ask it to verify accepted fixes, reconsider rejected findings using the
writer's evidence, and identify newly introduced issues. Then repeat assessment and STOP.

For Codex collaboration tools, read [the runtime binding](references/codex.md) before dispatch. On other hosts use the available native spawn and same-agent continuation operations; do not assume tool names or model aliases.

## Stopping conditions

- **No findings:** report that the reviewed snapshot passed, disclose validation limits
  and end the turn. Do not consume remaining rounds automatically.
- **All findings rejected:** report that outcome accurately; it is not a reviewer verdict
  of "no findings". Stop for the user's decision.
- **Round cap reached:** report unresolved/accepted-but-unapplied findings and stop.
  Do not apply fixes that would require an unbudgeted review round. Continuing requires
  an explicit cap extension or a clearly requested change of workflow.
- **Unavailable reviewer/tools or failed dispatch:** report the blocker and stop.
  Never silently replace the reviewer, change its model, or claim independent review
  from the writer's own inspection. Replacement requires a user-approved continuity reset.
- **Pause, cancellation or changed direction:** preserve the record and follow the user.
  A materially changed task or model/effort request needs an explicit reset if the runtime
  cannot honor it while retaining the same reviewer.

At every checkpoint, approval is required by this user-defined workflow. If asked why
work stopped, identify this skill and the checkpoint rule, not a generic permission policy.
Successful review does not itself authorize commits, pushes, deployments or ticket updates;
perform those only under separate applicable user authorization.
