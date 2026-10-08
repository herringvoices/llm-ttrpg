# LM-05 — Direct NPC replies and authoritative escalation

Issue: https://github.com/herringvoices/llm-ttrpg/issues/50

## Ordinary dialogue

The desktop's LM-03 conversation segments opt into `performConversationTurn({ ordinaryFastPath: true })`. When one NPC is present, pressure is already assessed, no player operation or authorized consequential testimony/commitment is attached, and the actor perspective can see the speaker, `tryOrdinaryNpcConversation` emits one `conversation.npc-reply.v1` structured response. This response is **final NPC dialogue**, not an internal plan requiring a second narration generation.

The strict schema offers two choices: ordinary `speech`, optional brief incidental `visibleManner`, `continueConversation`, and `materialSignal: "none"`; or `escalate` with a bounded reason and optional proposed summary. The normal output becomes visible text with deterministic formatting, while the exact player declaration and quoted fragments stay unchanged in the player transcript/working context. Silence and refusal to answer are valid. An invalid model response can be repaired **once**; unrecoverable malformed output produces a clear error without committing speech.

NPC briefs use the LM-02 actor-knowledge view and at most six subjective beliefs, three goals, three memories, six actor-visible utterances, and a current stance. The legacy shared compacted summary is excluded because it lacks per-NPC access provenance. They never read another NPC's cognition as a shared group mental state or pass belief truthStatus, canonical IDs, an entire social record, or private model plans. A belief is labeled a **character belief**, not canonical truth. Short working transcript entries are capped at 12; this is not a long-term summarizer.

An ordinary reply changes **only the in-memory working conversation state** and the UI's player-facing transcript. It adds **no canonical communication event, NPC memory, belief, commitment or relationship mutation**. Thus merely saying something does not make a new fact true. LM-06 will determine any broader retention policy.

## Escalation and compatibility

The NPC explicitly chooses `escalate` for material disclosure, promise, conflict, action or trade. A conservative content check also refuses to treat obviously binding/admissive first-person speech as ordinary. Escalation **does not commit the proposed draft**. It starts the existing, operation-authorized conversation path from the unchanged world and its original preauthorized intent/testimony constraints; the established `recordCommunicationOperation`, `applyConversationConsequencesOperation`, and event/source guards still decide whether any real consequence exists. A model must not invent player commitments, numbers or canonical truth.

The legacy path remains available for callers that do not opt in, unassessed Action Pressure, absent/offscreen recipients, preauthorized non-speech actions, and multi-NPC turns. Those exceptional paths can still use their existing calls and must be reworked independently before promising a one-call total across all dialogue. Existing save structures, conversation request/response fields and schema versions remain readable.

## Action Pressure, ordering and failure boundaries

The player words and reply are conservatively estimated at roughly three words/second, with a minimum interaction cost, and compared against the **existing assessed** Action Pressure maximum. The model cannot freely increase it. If the exchange would exceed the authorized horizon, the fast path refuses commitment with a recoverable boundary message; unassessed scenes fall back to the legacy authoritative pressure assessment rather than inventing one. The state revision and event sequence are rechecked after the model call, so a concurrent commit cannot be silently ignored.

LM-03 movement/action segments commit before the dialogue call; its fresh world snapshot and actor visibility are used for the NPC reply, and failed preceding actions stop the dialogue entirely. The fast path has no authoritative writes to replay; exceptional action receipts retain their current safe retry semantics.

## Scripted comparison

For a routine, already-routed, one-NPC exchange:

| Stage | Prior model calls | New model calls |
| --- | ---: | ---: |
| Interpret/normalize player speech | 1 | 0 |
| Construct NPC response | 1 | 1 |
| Per-turn durable extraction (desktop previously enabled) | 1 | 0 |
| Rewrite NPC decision as narration | 1 | 0 |
| **Total after LM-03 routing** | **4** | **1** |

A malformed output may cause one corrective attempt, and a material escalation may invoke the full authoritative path. Multi-NPC and unassessed-pressure exchanges retain the legacy path. The `tests/desktop-playable-loop.test.ts` fixtures and `packages/reference-game/test/conversation-integration.test.ts` cover normal calls, privacy, exact quotes, progression to a second beat, refusal, escalation and retry.

This is a **scripted architectural comparison**, not measured local-model latency or quality. LM-01's diagnostics can record actual model durations and prompt size; bundled-model response time, invalid-output rate and dialogue quality have not yet been benchmarked. No speed improvement is asserted beyond fewer planned invocation steps.
