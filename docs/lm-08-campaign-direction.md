# LM-08 — Foreground Campaign Direction

**Implementation status:** Deterministic, compact, source-triggered campaign review in `packages/engine/src/campaign-direction.ts` and `apps/desktop/src/play-session.ts`.

## Separation of responsibility

> Simulation determines what is true. Planning suggests what deserves attention. Narration and scene presentation decide how to convey it.

The three-horizon `CampaignPlanDocument` schema and independent planner store/checkpoint contract are unchanged. Existing saves load as before; the desktop initial plan now derives thread titles/tensions from established player identity, first recorded goal, and committed opening entity, rather than inventing a fixed quest.

`projectCampaignDirection` generates an explicitly private GM projection of up to five active threads, current tensions, three player-stated goals, and existing conditional opportunities. It enforces a 3,200-character cap. A private engine-only sidecar binds local `thread.N` aliases to stable thread IDs; those IDs and original grounding references are not serialized into the compact model prompt. The projection is **not** part of player/NPC/narrator model context.

## Foreground trigger gate

The desktop no longer calls `replanIfInvalidated` after each turn. The new pathway:

1. Load the saved plan. Compare **only references owned by active plan threads** against the pre-turn snapshot. This catches material authoritative state changes even when successful actions emit no canonical event.
2. If no reference changed, no scene changed, no substantial fictional downtime elapsed, and there are no new committed event receipts, return a deterministic routine no-op: **zero planner validation, history reads or model calls**.
3. For new event receipts, read only the bounded window of recently committed events, never unrestricted `eventHistory()` solely for planning. Filter strictly typed material event categories and related thread sources; ordinary resolution receipts do not qualify.
4. At a relevant canonical source change, location/scene transition or downtime of at least 24 fictional hours, validate only impacted, machine-checkable assumption references. Missing historical event evidence in a limited query becomes **unknown**, not false. Heuristic assumptions are not asserted false.
5. Present the bounded GM direction and relevant validation summary for **one structured review decision**. A normal review never automatically cascades low → medium → high.
6. Apply a model suggestion through existing plan-mutation validation and optimistic plan/world/event revision checks. Planning never writes world state, events, player choices or actor beliefs. If the planner fails, is invalid or races an authoritative update, retain the previous plan and allow gameplay to continue.

Possible decisions: `keep` (no revision), `revise-thread` (existing thread priority/tension and optional horizon summary), `retire-thread`, `propose-opportunity` (conditional, grounded in an existing thread), or `defer-escalation` (no immediate second model call). The reviewer cannot select unlisted, inactive or cross-horizon threads. Player-established goals are never a model-writable field.

This is **not a world clock**, background worker, quest injector or narrator. Long quiet play may still be ordinary. A scene/downtime boundary permits grounded attention review without compelling an event, and `keep` is explicitly preferable when there is nothing to adjust. The narrator remains responsible for pacing, tone and presentation.

## Diagnostics and limitations

Each turn reports a `plannerReview` diagnostic: reason or no-op, history query count/records read, number of evaluated and invalidated assumptions, context character count, model calls, decision and plan revision before/after. LM-01 per-turn provider diagnostics separately measure measured model time and **only provider-reported** token counts.

Legacy `runPlannerPass` / full three-horizon proposal remains available as an explicit specialized engine API, but desktop ordinary play no longer invokes it. The `defer-escalation` decision does not perform a broader review in the same turn; a future explicit major-arc direction-review API can specialize this rare workflow. Candidate event-type matching is deliberately conservative; content packages with additional material event types should register a typed trigger rather than assuming every event is plot-worthy. Source projection is private planning material and **never authorizes an offscreen revelation**.

Automated scripted tests verify bounds, source changes, routine skips, one-call decisions, no canonical mutations and invalid output. These do not prove real local-model latency or token savings; bundled-model measurements should be collected separately in LM-01.
