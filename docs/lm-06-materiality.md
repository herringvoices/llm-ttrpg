# LM-06: Package-owned materiality and event-sparse history

Issue: https://github.com/herringvoices/llm-ttrpg/issues/51
Date: 2026-10-08

## Three retention tiers and evidence

| Tier | Authority | Examples | Persistence |
| --- | --- | --- | --- |
| Ephemeral | Scene/renderer only | Incidental look, manner, discarded response draft | No canonical mutation/event; may expire when scene ends |
| Continuity | Player transcript / bounded current conversation | An ordinary question, routine task, visible NPC reply, result of a no-effect operation | Existing presentation transcript, working state, or action run receipt; not a public world truth |
| Canonical | Validated registered operation | Real traversal/location change, skill change, binding testimony, damage, power manifestation | World entity/fact/state mutation and/or typed material event |

`OperationMetadata.retentionClass` declares a package's ordinary retention expectation. Engine runtime validates registered metadata, and the operation result validator rejects `ephemeral` operations that attempt to write canonical mutations or events. Continuity operations **can** still create material outcomes, with explicit package-authored conditions. There is **no global post-hoc event deletion**: event authority and causal validation remain in the existing `applyOutcome` pipeline. World revision increments on a legitimate committed time-only operation even when event sequence does not; neither number may be silently substituted for the other.

The action-run receipts (committed step IDs, duration, input, result, mutations/events, revisions and RNG where applicable) are kept by the existing execution machinery. An operation returning no events is still a real completed operation with elapsed time. Presentation transcripts and short NPC continuity are never model-claimed canonical facts.

## Concrete reference-game policy

| Producer | Old default | New rule | Consumer / compatibility |
| --- | --- | --- | --- |
| `rules.actions.complete-routine-task` | Public `rules.routine-task-completed` event every use | No events/mutations; retain authorized time and normal action receipt | **Legacy event type remains registered** for historical saves |
| `rules.social.record-communication` | Internal event every utterance | No event for nonmaterial unsourced speech; keep sourced testimony, material semantics, deceptive/withheld delivery, or explicitly required extraction provenance as material | Existing `communicationRecordPayload` and belief source authority unchanged |
| LM-05 ordinary NPC reply | Prior multi-stage canonical communication | Working transcript / player-visible presentation only | No truth promotion or extra extraction pass |
| `rules.actions.enter-local-place` | Stable nested location, facts and event | Keep all changes for a real new place/transition; requesting the place where the actor already is produces only a time-only no-op | No phantom nested duplicate of the current room |
| `rules.actions.traverse-route` | Current location + public traversal event | Preserved | Event-interest world processes and traversed-route causality remain intact |
| Generic resolution, injury, skill, power, scheduled work | Material mechanical effects and registered events | Preserved | Existing safety, RNG, advancement, event subscriptions and plan validation preserved |
| `rules.progression.record-opening-turn-evidence` (new) | Previously depended on a routine-task or communication event | **Single GM-only causal anchor** when the first-power threshold is reached without another event | See opening evidence below |

### Event-consumer inventory

- **Opening progression / first power:** previously read only `developmentSignal.eventIds` and conversation event IDs; required an event ID for each first-power allocation. This is replaced with a narrowly scoped, GM-only `rules.opening-turn-evidenced` event after a *successfully completed* turn whose stable transcript entry was persisted. `manifest-first-power` keeps its existing registered input/event formats and links back through `causedByEventIds` and skill-allocation evidence IDs.
- **Planner:** uses canonical event history and validation against world state. Material operation events remain in that history. No-effect time-only commits advance world revision but not event sequence. LM-08 owns any more detailed distinction in plan trigger cadence.
- **Lazy world processes / schedules:** event-interest subscriptions and causal chains depend on actual material event types, not routine-task completion. Material traversal, resolution and progression events remain unchanged; scheduled cursors and due times still see committed fictional time.
- **Player UI:** preserves submitted player transcript and authored NPC reply; canonical history is not used as a substitute for their messages.
- **Save and replay:** old `rules.routine-task-completed` remains registered, no bulk history migration/deletion. Ordinary action-run receipts preserve complete execution identity on replay and re-open, including outcomes with zero event IDs.

### First power from an event-sparse turn

The opening deadline still counts **meaningful player turns**, not material-event count. When the target turn finishes with no material event and no previously stored opening evidence, desktop invokes the trusted `rules.progression.record-opening-turn-evidence` operation with the **already-persisted player transcript ID**, actor and the successfully resolved turn type. It emits one GM-only `rules.opening-turn-evidenced` event for that particular awakening trigger (not one event per prior routine or talk turn). The event is retained in the existing `manifestationEvidenceEventId` field, so old saves with ordinary event IDs remain valid. An anchor with the same committed player transcript ID is reused after an interrupted persistence update instead of being duplicated. Power generation, rules authorization, character mechanics, causal event source, and postcommit narration/retry continue to use the existing architecture.

This does **not** introduce a new model judgment of importance or a new scripted character action. The opening event is a typed proof that the already resolved turn reached its power threshold. It must not be confused with the preceding activity being magically important on its own.

## Reproducible baseline and quality constraints

`tests/materiality-retention.test.ts` executes **20** plain reference-game routine operations with 1-second durations: the expected delta is **20 world revisions, +20 seconds fictional time, +0 events, +0 entities/facts/beliefs/social records**. The previous registered routine implementation produced one event per call, so the event count changes from **20 to zero** for this direct-operation fixture (not necessarily for a full desktop campaign where opening powers and other material events may also occur). Saving/reopening after the 20 turns retains fictional time and history sequence. Then entering a real new room creates the normal canonical location state and one event, while re-entering the same room creates neither another room nor another event.

A second test verifies that an incidental unsourced question creates no event, while a consequential threat retains an authoritative communication event. Desktop scripted opening tests check first-power manifestation, saved reload and failed narration/power-generation retries. Existing RNG, planner, simulation, and event-history tests remain regression guards.

The direct-operation test **does not** claim 20 per-turn desktop chat transcripts or action-run receipts; these are exercised by other tests. Nor does it assert a measured local-model improvement. Provider latency, context length and subjective story quality must still be compared using LM-01's diagnostics.

## Boundaries for follow-up

LM-07 owns actor-aware condensed long-term memories and expiration of scene-local details. LM-08 owns detailed event/turn planning cadence. LM-10 owns lazy people/place realization. The LM-05 fast dialogue still does not advance fictional time via a separately durable conversation receipt, to avoid double-consuming time on retries; this remains a separate conversation lifecycle hardening task. Existing old event-rich saves retain their original references; no migration rewrites them.
