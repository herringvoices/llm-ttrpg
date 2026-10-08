# LM-03: Unified declaration classification and registered-handler routing

Issue: https://github.com/herringvoices/llm-ttrpg/issues/48
Date: 2026-10-08

## Intent and authority

The desktop gameplay path no longer asks a keyword-based `desktop.turn-route.v1` model and then asks `player-action.intent-interpretation.v1` to interpret an action again. `classifyTurnDeclaration` in `packages/engine/src/turn-declaration.ts` asks **one** compact `turn.declaration.v1` question (up to one bounded corrective retry for malformed output, unauthorized references, or an unnecessary clarification). Its strict result contains ordered action and communication segments, semantic modes from the existing registry, target/recipient aliases, stated means, action-pressure assessment and requested horizon; optional quoted speech must match the player's original words exactly.

For the narrowly specified `I look around.` and `I take a look around.` forms, a previously **assessed** pressure state allows a deterministic observation classification without a routing model call. No broad keyword list is used to interpret unfamiliar or creative declarations. If classification would omit an actionable clause, alter quoted speech, or use an unauthorized/stale scene alias, the engine rejects it rather than guessing.

The original declaration remains authoritative. For action segments, desktop passes `preinterpretedPlayerActionSchema` to `GameSession.performPlayerAction` so the engine does not interpret it a second time. The engine checks that the declaration, world revision/event sequence, and currently authorized visible targets match before it writes an action run. Action Pressure is bounded through existing `boundInterpretedIntent` and existing transaction/receipt checks, with no rule or save migration.

## Registered operations rather than model-led discovery

Desktop passes `registeredOnly: true`. The engine calls `toolCatalog.listActionCandidates` with the classified semantic modes and any active tool-availability policy. A unique registered candidate is selected without another model tool-choice call; the model may still need to provide arguments conforming to the operation input schema. Multiple candidates receive a constrained choice only among their available descriptions. Normal desktop gameplay cannot issue model-selected `discover-subsystems`, `discover-tools`, or `inspect-tool` requests.

When there are no applicable specialized operations, only a package-registered `generalFallback` can be used. The reference game marks its general Performance-versus-Resistance resolution accordingly. The contract-game fixture declares its own fallback independently. If neither exists, the turn fails safely with an unsupported-capability explanation. The engine contains no hardcoded reference-game operation identifier. Complex mechanical argument building remains LM-04's responsibility; final stop decisions and longer action lifecycle policy remain LM-11's responsibility.

## Ordered turns, partial commits and retries

The classifier preserves sequential segments, including action before speech. Each segment is resolved in the submitted order; the next uses the resulting authoritative world and requires refreshed actor visibility for any recipient. A failed/unresolved prerequisite stops later segments rather than authoring speech that did not occur. Previously committed operations are not rolled back or silently replayed.

Each action's stable identity is derived from the **persisted player transcript message ID and the original segment index**. The transcript entry is saved before the first segment can commit. Narration retry reuses the existing action run and its receipts. When only a later segment needs clarification, the pending continuation concerns that segment, not earlier completed segments. The original action-run schema and old saves remain readable. Automatic restoration of an interrupted *multi-segment orchestration* across an application crash is still a separate hardening opportunity; stable ids allow explicit replay/idempotency checks but are not an automatic resume service.

Direct non-desktop callers of `performPlayerAction` can still use its original interpretation path for backwards compatibility. Tool-tree discovery remains available to developer/debug workflows, not to new desktop gameplay.

## Diagnostics and reproducibility

The scripted desktop test `runs a freeform turn through production orchestration` checks that only one `turn.declaration.v1` call classifies the action, with zero desktop route and zero second intent-interpretation calls. Its one-operation path still uses one arguments call, one final stop call, and one narration call. The last two are intentionally **not** claimed to disappear in LM-03. Relative to the old speech-keyword router, a communicative declaration classified as an action no longer incurs route **plus** action interpretation (two separate initial decisions); it uses one. This is an architectural comparison of the previous code path, not a bundled-model latency benchmark.

Other scripted tests cover multi-action ordering/replay, actor-private brief boundaries, one corrective retry for a forged scene reference, verbatim speech and ordered action/communication segments, and a broad requested search curtailed to the **5-second** Action Pressure 9 maximum. CI `npm run check` is the scripted baseline. See also `docs/lm-01-baseline.md` for the manually reproducible bundled-model timing and quality comparison.

**Bundled-model quality, provider tokens and latency: not measured here.** Any future comparison should use matching save fixtures and LM-01 invocation diagnostics rather than treating fewer model calls as evidence of better story quality.

## Explicit boundaries

No rewriting of the NPC dialogue/decision pipeline (LM-05), PerformancePlan construction (LM-04), rolling memory (LM-07), authoritative goal-completion and stopping policy (LM-11), or narrative voice (LM-12). This ticket removes duplicated semantic routing and catalog navigation from ordinary desktop turns without granting more authority to the LLM.
