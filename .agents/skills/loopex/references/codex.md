# Codex runtime binding

With the collaboration tools used by this environment:

- Initial dispatch: `collaboration.spawn_agent` with `fork_turns: "none"`, the selected
  `model`, and `reasoning_effort` only if supplied. Retain the returned canonical agent ID.
- Later review rounds: `collaboration.followup_task` targeting that same ID. An idle
  reviewer needs a follow-up task; a plain message alone may not start a review turn.
- Use the available wait/status operations to collect the complete review. Do not create
  sidebar tasks as substitutes for reviewer subagents or assume tool names on other hosts.
