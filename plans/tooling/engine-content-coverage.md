# Engine resource workload correspondence

The [engine-only workload](../../tooling/suites/benchmarks/content/README.md) has
[recorded local executions](../../docs/evidence/engine-content.md). The following
correspondence establishes replacement methods and passing observations. The exact
retirement proofs below approve removal of old consumer imports, commands and
default CI stages after their replacements passed.

| Frozen obligation                   | Replacement                                       | Observed correspondence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workload:content-accounting`       | `tooling/suites/benchmarks/content/accounting.ts` | Every measured transition preserves the original four loaded/leased resources, zero loading/unleased resources, claims `{external:0,scene:4,dependency:0,renderer:2}`, one unknown-size resource, protected over-budget leases, two renderer sources/consumers, three textures, zero uploads/manual replacements, one voice/context and two bitmaps. Disposal requires zero assets, claims, renderer resources, voices, contexts, bitmaps and textures. Diagnostics and cleanup failures fail acceptance. |
| `workload:content-browser-observer` | `tooling/fixtures/content-engine/observe.ts`      | Typed platform interception counts actual image decode/close, texture create/destroy, source start/stop/ended and context close. Samples retain public engine inspections, GPU identity, visibility history and submission counts. Cancellation holds a real decoded external image in a fixture-owned gate, aborts preparation, releases late delivery and verifies disposal with surviving mounted ownership. No DOM game controls or schema assumptions remain.                                        |
| `workload:content-generated-churn`  | `tooling/suites/benchmarks/content/fixtures.ts`   | Thirteen deterministic external PNG payloads, twelve engine scene definitions and shared audio/opaque assets generate churn under three-entry/1 MiB retention. Each full run executes three repetitions of twelve warmups and 120 measured transitions, plus nine cancellation trials and three terminal disposals. Public-package declaration and runtime resolution, root/nested builds and immutable artifact checks execute in the isolated installation.                                             |

Old production transitions and their original budgets remain consumer-owned.
The new workload has different authored inputs and timing endpoints, so its
measurements establish exploratory observations only. Performance budgets,
environment profiles and strict/candidate comparison modes still need their own
implementation and evidence; old game thresholds are not replacement budgets.

The earlier machine evidence enumerated 21 unresolved mixed correspondences.
The retirement record now resolves each to named executed installed/unit/browser
or consumer-owned coverage. Animation clocks are consumer implementation, with
the unchanged independent-playback assertion and test retained there.
`tests/browser-content-cleanup.test.ts` remains active against shared cleanup:
failure restoring the first asset cannot prevent the second restore or injected
script cleanup, and all original failures remain observable.

## Consumer retirement update

The remaining mixed assertion correspondences and consumer retirement review are
recorded in [consumer retirement evidence](../../docs/evidence/consumer-retirement.md).
Its machine record names each original obligation, exact passing observations/tests,
consumer counterpart and remaining limits. Embedded consumer execution has been
removed from ordinary verification and default CI. Earlier statements above describe
the pre-retirement stage; frozen obligations and comparator-specific gates survive.
