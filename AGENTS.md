# NGNE repository instructions

Read and follow [RULES.md](RULES.md) for coding, documentation, validation, and
completion requirements before making changes in this repository.

## Authoritative documentation

- [Architecture](docs/architecture.md): model, ownership, execution order and required capabilities
- [Decisions](docs/decisions.md): rationale
- [Implementation contracts](docs/contracts/NGNE.md): exact API semantics and migration
- [Guide](docs/guide.md): usage; [roadmap](docs/roadmap.md): direction;
  [verification](docs/verification.md): dated evidence

Architecture and contracts take precedence over style. Read the relevant
documents before changing behavior. Apply the rules to new and modified code
without unrelated repository-wide rewrites.

## Working context

- NGNE is the engine; keep game-specific mechanics in games and examples.
- Follow the [guide](docs/guide.md) for usage and
  [verification notes](docs/verification.md) for validation context.
- Use the scripts in `package.json`: `npm run typecheck`, `npm test`,
  `npm run build`, and `npm run bench` as appropriate to the change. Include
  browser validation when changing browser-dependent behavior.
- Update the owning document for each changed fact alongside the change; link from others.
- Report changes, checks and results, and any unverified behavior or remaining decisions.

## Git commits

- Prefer 1-line commit messages - no co-authors or multi-line long messages.
- For commits coming from a Jira ticket, use this structure: [NGNE-<task number>] <commit message>
