# LM-07: Scoped, source-aware continuity for local models

Issue: https://github.com/herringvoices/llm-ttrpg/issues/52
Dependencies: LM-02, LM-06. This is **not** a new world simulation, canonical memory store or periodic model job.

## Authorities and contracts

`packages/engine/src/continuity.ts` defines `ContinuitySummary` v1: a scope (actor, relationship, location, scene or campaign), a **noncanonical actor/group perspective**, bounded `summaryText`, ordered points carrying typed `sourceRefs` and provenance class, status (current/stale/blocked), and a basis with game fingerprint, material-source fingerprint, world revision/event sequence, and fictional-time refresh marker. It does not modify the world, events, goals, commitments, beliefs, episodic memories, or player transcript.

An actor's goals, commitments, relationships, episodic memories and beliefs are selected **only for that actor**. Beliefs are prefixed `Believes (not confirmed fact)` and never expose `truthStatus`; no GM-only events or hidden facts are selected. Actor-facing public facts are restricted by explicit actor/location/relationship subject scope, not an unrestricted global fact dump. Public event summaries may enter only when they explicitly relate to the actor or requested scope. The selector prioritizes active obligations and important established personal history over low-salience chatter; deterministic ties use source type/ID. Default cap: 12 selected source records, 12 displayed points and 1,200 characters (absolute maximum 1,500). A long raw source is clipped to 196 characters without emitting canonical identifiers in prose.

The cache key includes world ID, declared scope, actor/group perspective, game composition fingerprint and configured cap. Every lookup reruns source visibility and source selection, then compares source fingerprints; an unrelated world revision/time-only routine operation produces a cache hit and **zero model refresh calls**. A changed material goal/belief/fact/event forces deterministic regeneration. Stale externally held summaries can be explicitly checked with `assessContinuityFreshness`, which refuses to carry previous text across source/visibility changes. A save without cache data reconstitutes the summary lazily from authoritative stores; no migration, long-term summary DB, global cache truth claim or deletion of old facts is required.

## Where gameplay consumes it

- **LM-05 ordinary NPC replies:** `conversation.npc-reply.v1` uses a compact, same-NPC derived continuity brief and at most six actor-visible recent utterances. It no longer passes a duplicate full array of NPC goals, memories and beliefs alongside the already compact context.
- **Legacy consequential / multi-NPC path:** replaces the full `actor-social-state` and `actor-beliefs` context items with one perspective-scoped continuity item. Each NPC gets its own projection; shared cross-NPC `compactedSummary` is never treated as private knowledge. Initial/ongoing working transcript is capped to 12 entries; only the last six visible entries (up to 250 characters each) are sent to a single actor. Durable extraction also receives bounded recent text, rather than an unlimited transcript. Exact player quotes remain authoritative in the recorded act and visible UI, not a duplicated model-memory array.
- **LM-03 player declaration routing:** desktop obtains the player's own authoritatively derived actor summary and supplies it to the compact model brief. Unrelated NPC social records remain unavailable.

Optional `condenseContinuityAtBoundary` makes at most **one** model call on an explicitly requested scene transition, material event, time jump, or historical recall **when more than six established points exist**. The model may only return existing point indices, not new prose or canonical source IDs. The runtime validates positions, duplicates, essential obligations/backstory and output size; malformed, timed-out, unsupported or overlong output falls back to the extractive source-checked summary without world writes. Ordinary dialogue and player turns do not invoke this extra call by default.

## Progressive targeted recall

`recallContinuity` takes a concrete scope, actor/group perspective, explicit query and optional authorized event history. It returns only a small keyword-matched subset of the same authorized source set, with typed source refs for follow-up inspection. It does not issue an LLM browsing loop, search all GM records, or claim to recall unrecorded casual conversation verbatim. Where exact old spoken words are not in canonical events they remain in the player's presentation transcript, not fabricated as a world belief.

## Measurement and test coverage

`tests/continuity-memory.test.ts` checks actor-secret isolation, subjective rumor attribution, update/contradiction invalidation, unrelated revision cache hits, overflow prioritization, typed scoped recall, safe re-derivation after save, invalid model selections, and mandatory obligations. `packages/reference-game/test/conversation-integration.test.ts` adds 20 ordinary conversation beats with a cap of six visible utterances before each model call and twelve working entries, with no additional model summarization call.

Diagnostics report selected/omitted sources, serialized summary characters, trigger (`initial`, `cache-hit`, `material-sources-changed`) and model refresh call count. The optional selection call reports its usage and fallback reason. This is an architectural/scripted prompt-growth measurement, **not** a measured speed or token-cost improvement for a bundled on-device model. Actual token counts remain the responsibility of LM-01 instrumentation when the provider reports them.

## Known boundaries

Derived summaries are lazily rebuilt after a restart; they are not persisted as canonical game knowledge. Public events are not universally assumed known by all NPCs: a public event must also be related to that actor or explicit scope. The targeted recall API is exposed to engine callers but does not automatically trigger on every free-text question: routing an explicit historical question to it as a deliberate operation can be extended separately. Source-grounded compact summaries intentionally cannot recover incidental dialogue that was neither retained in presentation history nor canonically committed. LM-08 handles planner refresh frequency, LM-10 handles lazy entity realization.
