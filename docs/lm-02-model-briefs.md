# LM-02: Compact, perspective-safe model briefs

Issue: https://github.com/herringvoices/llm-ttrpg/issues/47

## Contract

`assembleContext` and its access-controlled `ContextPackage` are still the engine's internal context infrastructure. `prepareModelBrief` (`packages/engine/src/model-brief.ts`) is a separate, deterministic view designed for a small local language model. It never consumes a canonical/orchestrator/planner/debug context: every brief must originate from a matching actor (or, for future NPC use, group) perspective that has already passed source authorization.

The projector exposes one small JSON object containing an ordinary `situation`, a subset of currently authorized scene elements, and optional committed public outcomes or actor-authorized short query results. It retains local `scene.###` references and display labels so structured model responses stay compatible with existing game operations. It deliberately omits bootstrap/composition, tool/discovery catalogs, provenance and access metadata, entity internals, raw stable IDs, full transcripts and private model plans.

`prepareModelBrief` returns three things that **must be kept separate**:

- `modelText`: the only part passed into the language model's context field.
- `localReferences` and `basis`: an **engine-only** reference table tied to the exact authorized scene and its world revision/event sequence.
- `diagnostics`: projector version, requested character budget, output size, omitted count and required-anchor overflow.

`resolveBriefReference` checks the supplied local reference against that one snapshot and rejects fabricated aliases, raw canonical IDs and stale snapshots. A later scene must create a new brief; a cached brief must never resolve against current arbitrary refs.

## Purposes and budgets

| Purpose | Default target (serialized characters) | Initial consumer |
| --- | ---: | --- |
| `routing` | 2,000 | Desktop speech/action routing |
| `action-interpretation` | 4,000 | Player action interpretation and forced clarification recovery |
| `operation-selection` | 5,000 | Engine execution decision and capability arguments |
| `npc-response` | 4,000 | Reusable builder for LM-05, not a conversation-pipeline rewrite in LM-02 |
| `narration` | 6,000 | Post-commit player-action narration and its retry path |

These are *targets*, not a claim of actual tokenizer counts or permission to drop essential context. The engine's existing deterministic scene ordering ranks the focal actor, declared/inspected targets, active interaction, participants, conditions and ambiance. The brief includes required focal/target/active/hazard/location anchors first, then adds lower-priority items while they fit. A required overrun sets `requiredOverflow=true`, and an extremely large required brief fails safely at the documented 16,000-character ceiling rather than silently truncating. Unknown/omitted information remains unknown, never absent.

The engine still makes tool-operation choices and executes mechanics through the existing validated operation registry. A read-only knowledge query now runs under the acting actor's perspective; only a small authorized result may be added to the next decision brief. Tool descriptions and applicable operations can still be supplied as specific schema-controlled decision input; the full catalog is not smuggled back into every context. Raw action receipt internals and non-public events are omitted from the decision-model recap.

The new path is selected directly at each upgraded call site. The older `renderContextForModel` remains available for other jobs and debugging, not as a silent fallback for a failed brief.

## Scripted before/after and safety baseline

The repeatable fixture in `tests/model-brief.test.ts` builds the *same authorized actor context* and compares:

1. **Before:** `renderContextForModel(context).length` (full serialized context).
2. **After:** `prepareModelBrief(...).diagnostics.serializedCharacters` (compact serialized brief).

**Recorded scripted example (CI, 2026-10-08):** the lobby fixture's actor-authorized full context was **2,809 characters** and the equivalent compact routing brief was **635 characters**, a **77.4% reduction** in serialized context length. These are character counts from the same fixture, not token/latency claims.

The scripted test asserts the latter is smaller; it also verifies determinism, masked identity protection, private hidden-door separation between actors, no raw entity ID, no catalog/provenance, preserved required anchors, explicit overflow, and invalid/forged/stale reference rejection. `tests/desktop-playable-loop.test.ts` and `tests/player-action-pipeline.test.ts` exercise actual routing and action execution. LM-01's `performance.calls[].promptCharacters` and optional reported usage tokens provide per-stage measurements for later comparisons.

For a local before/after *numeric* sample, log both lengths with the existing fixture while running `npm test -- tests/model-brief.test.ts`. Never compare serialized context size to reported model tokens as though the units were interchangeable.

**Real bundled-model tokens, wall time and prose quality: not measured in this environment.** Scripted size reductions demonstrate prompt reduction, not a proved performance win or improved narrative quality. The manual procedure in `docs/lm-01-baseline.md` can be replayed with the bundled model for that check.

## Compatibility and scope

No world or save schema migration. No extra summarization model call, no change to mechanics or Action Pressure, no persistent brief cache or telemetry upload. LM-05 can use the same perspective-safe projector for future NPC briefs, LM-07 can supply bounded authorized continuity later, and LM-12 can replace its other narration contexts separately.
