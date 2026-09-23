# Tooling checks

Run from the repository root with Node 24 and dependencies installed using `npm ci`:

```sh
npm test
npm run typecheck:tooling
npm run check:migration
```

`npm test` discovers engine tests in `tests/*.test.ts` and tooling regressions in
`tooling/tests/*.test.ts`. Keep entry files flat; fixtures can be nested. The Node
tooling configuration is independent of the browser/source-alias configuration.
Extend its includes when introducing additional Node modules; browser code needs
its own checked target. No public engine export changes are needed.

The migration checker reads the [planning records](../plans/tooling/README.md),
compares them with tracked and nonignored untracked surfaces, verifies the frozen
Git revision and workflow hashes, and checks the rendered ownership table. It
prints discovered/mapped/excluded counts and the number of blocked retirement
rows. A blocked retirement is expected while the old implementation remains.
A missing mapping, malformed document, stale table, changed command, unclassified
assertion or unproved deletion exits nonzero. It never edits or deletes files.

The checker needs the frozen revision in local Git history. CI fetches full
history for that reason. A shallow checkout must fetch that revision before
running the checker; a missing revision is a failure, not an exemption.

When adding a surface, review its owner and destination and update the inventory,
coverage and retirement records together. Do not erase frozen IDs. Render the
table using the exported `renderCoverage(inventory, coverage)` function, then run
Prettier and the checker. No automatic mapping-approval command is provided.

These checks establish ownership and migration gates. They do not execute the
planned installed fixture, consumer protocol, benchmarks or evidence exporter.
Existing browser, installed-content and benchmark commands still own those
operations during migration. Their prerequisites and behavior remain documented
in [repository verification guidance](../README.md), [benchmarks](../benchmarks/README.md)
and [content measurements](../benchmarks/content/README.md).
