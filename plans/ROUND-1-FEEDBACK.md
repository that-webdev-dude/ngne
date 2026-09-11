# NGNE-20 round 1 dispositions

The host accepts every substantive finding and revised `plans/PLAN.md` accordingly.

- F1 accepted: empty spawn remains the shared empty legacy archetype; zero-argument query is an all-entities compatibility query spanning both storage modes in preserved deterministic order.
- F2 accepted: world/query size and slot capacity semantics are explicit and tested across chunk boundaries; the benchmark asserts 20,000 live entities.
- F3 accepted: entity references use paired Uint32 index/generation columns, not BigUint64Array.
- F4 accepted: entity-reference inspection emits JSON-safe null or index/generation records and stringify determinism is tested.
- F5 accepted: legacy inspection records remain exact; schema chunk location appears only on live schema slot records and the contract migration note changes with it.
- F6 accepted with a scoped design: schema iteration uses one callback per chunk under a world read scope, preserves commit rejection, and expires descriptor/view lookup access after the callback. Raw typed arrays already obtained cannot be revoked without proxies or detachment, so retaining them is explicitly unsupported and is not claimed to fail at runtime.
- F7 accepted: invalid subject reads return undefined; null references return null; live/stale stored references return a frozen same-world stored-generation handle; stale same-world values may be written and foreign values throw.
- F8 accepted: World.access forwarding and the public query surface are explicit API-fixture targets.
- F9 accepted: engine tests move to snapshot(); constructor and restore share existing unsigned normalization; direct state assignment is a compile-time error.
- F10 accepted: a structural version changes only for topology/disposal and queries refresh lazily at size/eachChunk entry, so commit cost is independent of retained query count.
- F11 accepted: count is the sole live bound and vacated tails are cleared.
- F12 accepted: schema components/values/queries are nominally distinct from legacy Component<T>; schema use through get() is rejected by types and at runtime.

Please review the revised plan against these dispositions. In particular, judge whether the scoped `eachChunk()` borrowing contract is sufficiently honest and enforceable while still exposing direct typed arrays without per-row wrappers.
