## LM-01 — Add turn-level diagnostics and a minimal gameplay baseline

**Priority:** P0  
**Status:** Specified for implementation  
**Dependencies:** None. Implement first; LM-02 and LM-03 should use its measurements.  
**Related tickets:** LM-02, LM-03, LM-05, LM-06, LM-08, LM-13  
**Size:** Small-to-medium infrastructure ticket; deliberately not a full evaluation platform.

### Problem

The desktop play loop reports aggregate timing, a coarse action/conversation route, selected action traces, total entity/fact/event counts, and narration status. This is useful but incomplete:

- `apps/desktop/src/play-session.ts` records model time from available action trace metadata. Its route, conversation, planner, power-progression, and other model invocations are not reliably represented in the same per-turn total.
- `TurnDiagnostics.growth` currently stores **after-state totals**, not the number of records added by that turn.
- We cannot consistently answer which particular model calls consumed time/tokens, which returned invalid structured output, or where a repair/retry occurred.
- Full event-history and world-snapshot reads performed for diagnostics can themselves be expensive.
- Existing scripted tests prove a great deal of engine correctness, but do not give us a representative local-model baseline for common gameplay.

We need enough observability to test whether a refactor made the game **faster, less expensive for the local model, and at least as correct**, without building a new subsystem the game must depend on.

### Player-visible outcome

No change to fictional results, model prompts, tool choice, timing rules, state mutations, or save format. A developer can inspect a completed turn and see which stages ran, how much model work happened, and which persistent records changed. Diagnostic failures must never prevent a successful turn.

### Implementation decisions

1. **Use a per-turn model-runtime observer/decorator**, attached at the desktop play-session boundary, to capture every `ModelRuntime.generate` invocation and any `streamText` invocation actually used. Reuse existing `ModelResultMetadata`, `ModelUsage`, and `ModelTraceMetadata` rather than adding logging to individual model providers.
2. **Give each submitted turn a correlation ID.** Include the desktop route, action intent interpretation, execution decisions, conversation phases, narration, Awakening/power work, and planner calls under the same ID when those stages occur. Model calls outside a submitted turn (for example, initial generation) should be identifiable as separate lifecycle operations, not misattributed to the next player turn.
3. **Record measurements, not prompt bodies.** The default per-call record contains phase/operation, output kind and structured schema ID where applicable, wall-clock duration, provider-reported duration, reported input/output tokens if available, approximate serialized prompt length, success/failure, failure kind, and retry/attempt index where known. If a provider does not report token usage, mark it unavailable; do not infer invented token counts.
4. **Provide per-turn aggregation**: wall-clock time from beginning of submission to settled result, sum of model invocation durations, invocation count, failed invocation count, counts by phase, approximate prompt bytes/characters, reported tokens, and state-count deltas. A sum of overlapping model durations is **model work**, not necessarily wall-clock model latency. Define and label both.
5. **Capture state changes as before-and-after deltas**, at least for entities, facts, beliefs, actor social states, documents, simulation cursors, mechanical realizations, and events. Preserve absolute totals where useful. Use already available revision and event-sequence information rather than loading entire event histories just to count them. Do not add persistent writes for diagnostics.
6. **Keep collection non-authoritative and bounded.** Maintain a small in-memory ring of recent traces (for example 20). The current turn's diagnostics may continue through `PlaySessionView`. A failed observer, malformed provider metadata, or diagnostic formatting error is swallowed/reported independently and never changes authoritative behavior.
7. **Keep sensitive information out of diagnostic export.** Do not store or export raw prompts, full NPC private context, secret facts, API credentials, or model completions by default. Sanitized metrics only. If future work adds detailed prompt inspection, it must be an explicitly opt-in developer capability with separate authorization and redaction.
8. **Add a minimal baseline scenario suite**, not an automated prose-quality judge. Scripted fixtures can assert instrumentation and routing counts; manual, opt-in bundled-model runs capture real timing and a human-readable quality checklist.

### Proposed diagnostic shape (illustrative; adapt to repository conventions)

```ts
interface ModelCallDiagnostic {
  operation?: string;
  schemaId?: string;
  outputKind: "text" | "structured";
  elapsedWallMs: number;
  elapsedProviderMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  promptCharacters: number;
  status: "ok" | "failed" | "threw";
  failureKind?: string;
}

interface TurnPerformanceDiagnostic {
  turnId: string;
  route: "action" | "conversation" | "mixed" | "needs-clarification";
  totalWallMs: number;
  modelWorkMs: number;
  modelCallCount: number;
  calls: readonly ModelCallDiagnostic[];
  before: Record<string, number>;
  after: Record<string, number>;
  delta: Record<string, number>;
  worldRevisionBefore: number;
  worldRevisionAfter: number;
  eventSequenceBefore: number;
  eventSequenceAfter: number;
  outcome: "resolved" | "needs-player-input" | "failed" | "committed-presentation-failed";
}
```

The example is an outline, not a requirement to abandon the existing `TurnDiagnostics` shape. Extend it compatibly where possible.

### Baseline scenarios

Create a small, repeatable table of declarations and expected **semantic behavior**, backed by the existing scripted test-game fixtures and by opt-in real-model runs:

| Scenario | Example declaration | What must remain true |
| --- | --- | --- |
| Observation | "I look around the room." | Visible surroundings only; no invented canonical discovery |
| Routine action | "I sit down and eat breakfast." | Ordinary action resolves without unnecessary mechanical ceremony |
| Movement | "I go into the kitchen." | Destination and location changes are coherent |
| Single-NPC dialogue | "I ask Mara what she saw." | Right recipient and no private-knowledge leakage |
| Mixed declaration | "I approach Mara and ask what happened." | Both movement and speech are honored in order |
| Creative uncertainty | "I throw my flashlight at the switch." | Player's means are preserved; rules decide the outcome |
| Pressured time | "I spend the morning searching for Jonny." | Authorized horizon is respected |
| Power use | "I try using the strange ability I just gained." | No fabricated capability; resolved against established mechanics |
| Retry | Retry a narration failure after a committed action | No duplicate authoritative effect |

At this stage, scripted fixtures assert technical invariants; a short developer checklist records real-model outcome quality (faithfulness, intelligibility, continuity, hidden-information safety). Do not use an additional LLM to grade every turn.

### Expected code touchpoints

- `apps/desktop/src/play-session.ts` — correlation lifecycle and `TurnDiagnostics` aggregation.
- `packages/engine/src/model-runtime.ts` — existing call/trace/usage types; optional non-breaking observer utilities.
- `apps/desktop/src/model/llama-cpp-model-runtime.ts` and `ollama-model-runtime.ts` — only if metadata genuinely lacks something; avoid provider-specific implementation where an engine wrapper is sufficient.
- `tests/desktop-playable-loop.test.ts`, `tests/model-runtime.test.ts`, and a focused diagnostics test file.
- Existing `npm test`, `npm run typecheck`, `npm run check` commands; optionally a manual benchmark script documented in `docs/`.

### Acceptance criteria

- [ ] Every model invocation belonging to a submitted desktop turn appears **exactly once** in that turn's collected call list, including planner, conversation, and power work when invoked.
- [ ] Failed/invalid calls and subsequent retries are separately visible; unavailable token metadata is represented as unavailable, not zero.
- [ ] Aggregate invocation count, reported token totals, timing, and per-call stage can be inspected without relying on action trace internals.
- [ ] Before/after and delta values are correct, including a turn with **zero** persistent changes.
- [ ] A resolved action followed by a failed narration reports a committed-but-presentation-failed outcome and does not replay the action for logging purposes.
- [ ] Scripted fixture tests verify call accounting, thrown-provider behavior, retry accounting, no impact on execution, bounded memory, and no leakage of raw prompts/private state in normal diagnostics.
- [ ] The baseline scenarios can be run with scripted models in CI. A documented **manual** path exists for the bundled local model; CI does not require GPU access or downloading a multi-gigabyte model.
- [ ] A baseline report is committed alongside the work, clearly identifying which metrics came from scripted fixtures versus actual local-model runs. If no local model is available in the implementation environment, record **not measured** rather than claiming performance improvement.
- [ ] `npm run check` passes.

### Explicit non-goals

No prompt restructuring; no change to Action Pressure, conversation extraction, campaign planning, or action mechanics; no hard latency SLA; no persistent telemetry database, analytics service, background upload, automatic LLM judge, or model benchmark leaderboard. LM-13 will turn useful measurements into release-quality gates.

### Rollout / compatibility

No save migration. Make diagnostics optional, lightweight, and safe to disable. Existing presentation/UI behavior must be unchanged. Preserve existing trace payloads if external tests or developer tooling consume them.

### Definition of done

A developer can run the scenario suite and inspect a complete, privacy-conscious per-turn model-call breakdown and state delta. We have a real baseline to compare against LM-02 and LM-03 without adding work to the player's actual turn.

---

## LM-02 — Introduce compact, perspective-safe model briefs

**Priority:** P0  
**Status:** Specified for implementation  
**Dependencies:** LM-01 for reliable before/after measurement; implementation can begin independently.  
**Related tickets:** LM-03, LM-04, LM-05, LM-07, LM-08, LM-12  
**Size:** Medium; this establishes a reusable engine interface, not a rewrite of the world model.

### Problem

`packages/engine/src/context.ts` already applies useful availability, perspective, local-reference, salience, and budget rules. However, `renderContextForModel` serializes a broad `ContextPackage` including bootstrap/composition material, situation fields, retrieved-item wrappers, provenance, access annotations, and discovery/catalog scaffolding. A small local model must parse substantial machinery before understanding an ordinary scene.

The existing budget uses `JSON.stringify(value).length` as a character-based estimate, not a tokenizer count. Required items can also exceed the target budget. The answer is **not** to delete the access-controlled context system. It is to keep that system as the engine's internal source of truth and build much smaller model-facing projections for specific jobs.

### Player-visible outcome

The game remembers and presents immediately relevant details, NPCs act using information they are actually entitled to know, and the narrator describes only observable/committed information. Routine turns need far less model input. Long campaigns may still keep rich world state, but that state is not dumped into each prompt.

### Implementation decisions

1. **Keep `assembleContext`, source providers, access checks, and local-reference authorization as internal infrastructure.** Add a dedicated, deterministic **model-brief projection** layer; do not grant individual model stages raw `WorldState` or a serialized `ContextPackage` as a convenience shortcut.
2. **Create a small set of task-specific views**, built from common constituents rather than one universal giant schema:
   - `SceneBrief`: fictional time (when relevant), visible location/conditions, action pressure, immediate participants/objects/affordances, active threat or interruption, and the smallest necessary recent continuity.
   - `PlayerActionBrief`: scene plus relevant player capabilities/condition, declared goal/means, target references, and constraints for the action being considered.
   - `NpcBrief`: the same immediate setting from **that NPC's knowledge perspective**, plus short role/personality/motivation, relationship or memory relevant to the player, and current player utterance.
   - `NarrationBrief`: player-observable scene plus authoritative outcome receipts projected to that observer; never raw private canonical events or uncommitted proposals.
   - A `RoutingBrief` may be a strict subset of `SceneBrief`; it must not include full tool catalogs or hidden planner material.
3. **Make roles and perspectives explicit inputs to the builder.** NPC briefs must use actor/group perspective authorization. Routing and narration must be filtered for the **player-observable** scene, even if a separate trusted orchestrator internally has broader access. Do not let a canonical perspective accidentally leak canonical identities, intentions, hidden objects, or privately held beliefs into model-facing narration or NPC speech.
4. **Prefer concise, readable fields over nested JSON paperwork.** A structured internal TypeScript/Zod model is fine, but the serialized output should contain ordinary concise labels, summaries, and recognized local references. Exclude provenance, stable canonical IDs, access-policy internals, catalog hierarchy, arbitrary entity blobs, entire transcripts, and model decision records from the model-facing representation.
5. **Keep an engine-only reference table.** If the model sees `scene.001` (or an equivalent local alias), the engine retains its authorized canonical ID mapping. A model-proposed reference must be validated against the *same brief snapshot* before operation execution. Do not resolve a stale alias against a new scene or allow a model to supply a canonical ID in place of an allowed alias.
6. **Use deterministic relevance filtering**, not a preliminary LLM retrieval pass. Rank: player/target/active interlocutor; active hazard/condition; directly actionable surroundings; recent relevant participants; finally ambient details. Provide a stable tie-break order. Restrict by location/visibility/knowledge before ranking. A deliberately inspected or explicitly named item is a required anchor.
7. **Define budgets per task.** Initial ordinary-play target: approximately **2,000–6,000 characters of serialized brief**, with a smaller target for routing and a larger allowance for a consequential scene. Track actual provider token usage via LM-01. Budgets are **targets for model-facing material**, not license to omit indispensable information. If required anchors exceed the target, expose an explicit overflow diagnostic and use a documented safe higher limit or fail safely; never silently truncate a target, safety constraint, quoted speech, or hard rule.
8. **Keep continuity lightweight in this ticket.** Reuse an available bounded current-scene/recent-turn projection; do **not** generate new persistent summaries or add summarizer model calls. LM-07 owns when durable rolling summaries are created/refreshed. A brief builder may consume those summaries once they exist.
9. **Keep prompts honest about unknowns.** An omitted detail is unknown to the model, not proof that the world lacks it. Avoid defaulting unknown geography, character memories, inventories, or mechanisms into canonical facts.
10. **Integrate incrementally through a feature-gated path or independently switchable call sites.** Replace the model-facing context used by desktop routing, action interpretation/selection, and post-commit action narration first. Expose the same brief builder for LM-05 conversation and LM-12 narration work without requiring those later workflow refactors in this ticket.

### Proposed API sketch (adapt naming to existing packages)

```ts
type BriefPurpose =
  | "routing"
  | "action-interpretation"
  | "operation-selection"
  | "npc-response"
  | "narration";

interface ModelBriefRequest {
  purpose: BriefPurpose;
  focalActorId: string;
  perspective: { kind: "actor" | "group"; id: string };
  locationId?: string;
  declaration?: string;
  targetIds?: readonly string[];
  recentEntityIds?: readonly string[];
  maxCharacters: number;
}

interface PreparedModelBrief {
  modelText: string;
  /** Engine-only sidecar: never serializes into modelText. */
  localReferences: Readonly<Record<string, string>>;
  diagnostics: {
    serializedCharacters: number;
    omittedCount: number;
    requiredOverflow: boolean;
  };
}
```

Purpose and perspective must be validated together. If a privileged planner needs a different perspective in the future, that should be an explicit, separate policy path; it must not be possible to select `canonical` by simply passing a flag to an NPC brief.

### Example of intended model-facing output

```text
SCENE
You are in the motel lobby, shortly after midnight.
Mara (scene.001) stands beside the front desk. The entrance is behind you.
A loud crash was heard outside moments ago.
Pressure: urgent; only brief actions fit before the next interruption.

PLAYER
You are holding a flashlight. You have not inspected outside.
Declared action: "I approach Mara and ask what happened."

RELEVANT CONTEXT
Mara witnessed the crash; the player has not yet heard her account.
```

That example is **illustrative**, not a mandate to leak Mara's knowledge into the player's narrator brief. The final line belongs only in a brief whose authorized perspective can know it (for instance, Mara's own NPC brief). In a player-visible routing brief, that line must be absent unless established as something the player knows.

### Expected code touchpoints

- `packages/engine/src/context.ts` and `context-contracts.ts` — reuse current projection logic; add model-brief contracts and rendering.
- `packages/reference-game/src/context/` — ensure reference-game scene/character details can be reduced to concise observable summaries without privileged leakage.
- `apps/desktop/src/play-session.ts` — compact routing context.
- `packages/engine/src/runtime.ts` — compact action interpretation, applicable-operation selection and action narration context.
- `tests/context-assembly.test.ts` — perspective, salience, local ref, omission, overflow, and serialization tests.
- `tests/desktop-playable-loop.test.ts`, `tests/player-action-pipeline.test.ts` — compatibility across actual call sites.

### Acceptance criteria

- [ ] A documented model-brief builder exists and is used for the desktop action/routing path's model-facing context, without giving the model direct unrestricted `WorldState`.
- [ ] The common brief excludes bootstrap/discovery/tool catalogs, provenance/access metadata, raw stable IDs, unrelated world entities, and full historical logs by default.
- [ ] The engine still resolves authorized brief-local references to canonical IDs; unknown, forged, and stale references fail validation.
- [ ] Hidden door, undiscovered creature, unrecognized identity, NPC-private belief, and secret-relationship fixtures do **not** appear in player-facing briefs unless legitimately revealed. The actor whose knowledge includes a private fact can receive it in the appropriate NPC brief.
- [ ] Deterministic selection retains active targets, hazards, player-relevant constraints and explicitly inspected objects ahead of ambiance. Selection is repeatable given identical game state/request.
- [ ] Normal scripted scenarios usually produce a serialized brief within the provisional 2–6k-character target (routing generally smaller). Over-budget required context is flagged, not silently discarded.
- [ ] An NPC or narrator can function with a sparse brief and respond conservatively rather than inventing unseen details.
- [ ] LM-01 diagnostics make per-stage brief length and corresponding provider token usage measurable. Record a before/after sample without claiming a model quality improvement solely from size reduction.
- [ ] Existing action-pressure rules, operation outcomes, and old save data are not altered by the brief builder.
- [ ] Existing context authorization and engine tests continue passing; `npm run check` passes.

### Explicit non-goals

No schema migration of the world database; no summary-generation model; no deletion of the tool catalog or operation hierarchy; no replacement of the full context system for debugging/planning; no changes to mechanical check construction (LM-04); no NPC decision pipeline rewrite (LM-05); and no enduring memory-retention policy (LM-06/07).

### Migration / rollout

Add a new projector and keep the current `ContextPackage` available internally. Use the old model serialization only as a temporary rollout fallback, never as an unlogged silent behavior. If a feature flag is used, record which projection produced each invocation. Never persist generated briefs as authoritative facts.

### Definition of done

For ordinary actions, the model sees a concise, purpose-specific and perspective-correct description of the current situation, while the engine retains the rich world model and access controls. A future NPC or narration refactor can reuse the same projection without reintroducing the large context package.

---

## LM-03 — Unify declaration interpretation and route to registered semantic handlers

**Priority:** P0  
**Status:** Specified for implementation  
**Dependencies:** LM-02's routing/interpretation briefs are preferred. LM-01 provides instrumentation.  
**Related tickets:** LM-04, LM-05, LM-11, LM-12  
**Size:** Medium-to-large gameplay orchestration ticket. Refactor the hot path, not the ruleset.

### Problem

`apps/desktop/src/play-session.ts` currently uses `mayBeConversation` to decide whether to make a separate conversation-routing model call. If routed to action, `packages/engine/src/runtime.ts` then makes a structured intent interpretation call. Execution can repeatedly ask the model to select tools, supply arguments, inspect or discover catalog entries, and make a stop decision even when declared action modes are already covered.

The system already has an important partial solution: `semanticActionModeSchema` in `packages/engine/src/semantic-action.ts` and `toolCatalog.listActionCandidates(modes)`. This ticket should **finish using those capabilities**, not invent an unrelated new routing language.

### Player-visible outcome

Players can describe actions naturally, including mixed and surprising actions:

- "I open the door." → attempt to open the relevant door.
- "I look behind the counter." → observation, not a request to browse a tool catalog.
- "I approach Mara and ask what happened." → movement and communication, in that order.
- "I throw a torch into the grain warehouse." → attempt using the declared means; possible consequences decided by rules, not a hardcoded `burn-warehouse` command.
- "I search for Jonny all morning." → preserve broad intent and allow Action Pressure to bound the actual attempted time.
- "I use my power to shove the door open." → power use plus relevant interaction, with established mechanics respected.

Common turns should not need a separate `desktop.turn-route` call followed by another interpretation of the same declaration. Tool discovery is an **internal developer/engine facility**, not a normal player-turn model behavior.

### Implementation decisions

1. **Introduce one shared declaration-classification contract** owned by the engine rather than a desktop-only conversation schema. It should represent ordered **segments** when the declaration contains distinct steps. Each segment records whether it is action/communication, applicable existing semantic modes, authorized local target/recipient references, stated goal and means, and any explicitly quoted player speech **verbatim**. Preserve the original full declaration alongside the structured interpretation.
2. **Keep existing semantic modes**: `movement`, `interaction`, `manipulation`, `observation`, `communication`, `recovery`, `power-use`, `attack`, and `other`. A convenience grouping such as routine/uncertain/wait can be internal routing policy but should not silently invalidate ruleset registrations or persisted action runs. A request may have more than one mode.
3. **Choose a narrow hybrid interpretation strategy:**
   - Deterministic fast-path **only** for truly unambiguous, already-supported forms, with explicit visible target resolution and pressure compatibility; examples might include a basic "look around" or a clearly specified wait.
   - For everything else, **at most one compact structured interpretation call** for routing/classification. Do not build a growing collection of keyword heuristics that misreads ordinary prose.
   - If a fast-path cannot confidently preserve target, means, sequence, or scope, fall back to the model classifier. Unknown creative language remains valid input; it does not default to a forced routine operation.
4. **Pass the resulting interpretation forward.** Eliminate the duplicate desktop speech-classifier/action intent-classifier handoff. On the action path, allow `performPlayerAction` to accept a validated preinterpreted intent so it does not ask the model to re-interpret the same declaration. Do not loosen the existing `actionId`, immutable-run, world-revision, or authorized-horizon checks.
5. **Preserve Action Pressure now; simplify reassessment later.** The interpreted action must still supply or securely derive the fields required by `interpretedIntentDecisionSchema` / `boundInterpretedIntent`, including pressure level and requested horizon where needed for current behavior. Use the current validation rules. LM-11 owns revising when those assessments happen; LM-03 must not silently grant a longer action window.
6. **Resolve operations by deterministic engine selection from registered applicability metadata.** Use `listActionCandidates` (and policy authorization) to narrow the possibilities. For a unique safe candidate, invoke it through the existing operation binding and input validation. If multiple genuinely plausible candidates remain, use at most a small, bounded choice among their short descriptions or apply a documented deterministic precedence rule. Never ask the model to browse domains, subsystems, or the entire catalog during normal play.
7. **Treat unknown/creative attempts as first-class.** If no specialized operation matches, use a **package-registered general action/resolution fallback** where available and applicable (for the reference game, inspect the existing generic action resolution capability). Validate all arguments in the engine. If a package genuinely supplies neither an applicable handler nor a general fallback, return a safe, actionable unsupported-resolution result; do not fabricate a committed success or invent a new tool.
8. **Keep mechanical argument generation constrained until LM-04.** This ticket removes redundant interpretation and catalog navigation, **not** the `resolve-action` schema's complex `PerformancePlan`. A temporary model call to propose arguments for the chosen operation is permitted and must still pass its full schema/authority checks. LM-04 will replace those heavy mechanical proposals with engine-owned construction.
9. **Support ordered mixed speech/action.** Do not discard one part merely because a declaration includes dialogue. Execute prerequisite movement/action before speaking when the player specified that order; if the prerequisite fails or requires a player decision, do not pretend later speech happened. Where order is explicit ("first", "then", "before"), preserve it. For genuinely simultaneous actions, represent a coherent combined intent without imposing an arbitrary choice.
10. **Keep transactional and player-agency boundaries.** Each meaningful sub-operation must have a stable, distinct execution identity derived from the parent turn and segment position; retries must not replay committed effects. If speech follows a committed movement, the speech path sees the updated world state. A failed later segment must not retroactively invent or undo earlier committed actions. Preserve narration retry and pending player clarification behavior.
11. **Use clear stopping rules where already determinable.** Never require additional model-driven catalog discovery just to conclude that supported modes have been handled. A narrowly resolved single operation may complete when its validated receipt covers the declared objective and no further material player decision is needed. Deeper multi-operation stopping policy and full Action Pressure lifecycle simplification remain LM-11.
12. **Keep package independence.** The router depends on operation metadata and contracts, not reference-game-specific operation IDs baked into the engine. Reference-game choices live in its package adapter/registry; a high-fantasy package can register different operations while using the same semantic modes.

### Suggested contract shape (conceptual)

```ts
interface InterpretedTurn {
  originalDeclaration: string;
  segments: readonly (
    | {
        kind: "action";
        goal: string;
        modes: readonly SemanticActionMode[];
        targetRefs: readonly string[];
        statedMeans: readonly string[];
        // Existing bounded-intent pressure/horizon contract is retained.
        pressureLevel: ActionPressureLevel;
        requestedHorizonMs: number;
      }
    | {
        kind: "communication";
        recipientRefs: readonly string[];
        utterance?: string; // Preserve exact quoted player words.
        communicationMode?: string;
      }
  )[];
}
```

Make the actual schema concise and strict. The player declaration itself remains authoritative; interpreted segments are not a rewrite of what the player said. Do not drop a segment because it exceeds an arbitrary model-output cap; if the classification exceeds a safe processing limit, retain the original declaration and ask for a genuine choice or take the smallest faithful step.

### Failure behavior

- **Unambiguous declaration / known target:** act without requesting unnecessary confirmation or model interpretation.
- **Ambiguous target where one reasonable default exists:** select that visible/default target if this does not change the player's apparent goal.
- **Material ambiguity among different actions:** one concise player clarification; never ask the player to author an external outcome.
- **Model returns forged/stale local reference:** reject it and retry one bounded interpretation if safe; otherwise ask a concrete clarification, without changing state.
- **No specialized handler:** try package general fallback; do not expose tool-tree exploration.
- **Model or narration fails after a committed segment:** preserve committed receipts and allow safe presentation recovery rather than replay.
- **Action Pressure forbids requested duration:** run only a bounded attempt or return a grounded interruption/required player decision, never silently treat all requested hours as completed.

### Expected code touchpoints

- `apps/desktop/src/play-session.ts` — replace `mayBeConversation` + `routeDeclaration` distinction with the shared routed-turn result; pass the chosen route/segments into execution.
- `packages/engine/src/player-action-contracts.ts` — validated preinterpreted intent or routed-turn input; retain existing action-run schema compatibility unless a migration is deliberately required.
- `packages/engine/src/runtime.ts` — avoid duplicate interpretation, select registered candidates without normal-play discovery, preserve receipts and safe retries.
- `packages/engine/src/semantic-action.ts` and `tool-catalog.ts` — reuse existing semantic modes and candidate discovery logic; add only narrowly necessary metadata/selection helpers.
- `packages/reference-game/src/ruleset/` — ensure existing registered general resolution supports attempts outside specialized handlers; do not write reference-game operation names into engine core.
- `tests/desktop-playable-loop.test.ts`, `tests/player-action-pipeline.test.ts`, `tests/tool-catalog.test.ts`, `tests/action-pressure.test.ts` — regressions and new focused route tests.

### Acceptance criteria

- [ ] A single shared classification result handles direct actions, communication, multi-mode actions, and ordered mixed declarations, including quoted speech fidelity.
- [ ] Common action declarations are not interpreted twice by the desktop and engine; ambiguous turns have at most one **initial** classification call, with only bounded error recovery allowed.
- [ ] Obvious fast-path declarations can route without a model call; uncertainty or unsupported syntax reliably falls back to open-ended interpretation rather than keyword guessing.
- [ ] Registered operation candidates come from mode applicability plus authorization and local scene context, not from model-driven domain/subsystem/tool browsing.
- [ ] **Zero** `discover-subsystems`, `discover-tools`, or `inspect-tool` model decisions occur in normal gameplay routing/execution under the new path. Legacy developer/debug catalog inspection may continue outside it.
- [ ] Package-specific operations remain swappable without modifying desktop routing logic; specialized capabilities and a general fallback are testable using different registered fixtures.
- [ ] Mixed movement + speech preserves sequence, updates the visible world between segments, avoids phantom speech after a failed prerequisite, and cannot double-commit on replay.
- [ ] A creative generic attempt remains possible even without a bespoke operation; no canned-command vocabulary is imposed on players.
- [ ] Action Pressure caps, target authorization, operation schema validation, deterministic RNG, world revisions, idempotent receipts, and post-commit narration retry still work.
- [ ] Measured call counts drop where the old desktop conversation-route/engine action-interpretation duplication was involved; LM-01 report documents actual before/after by scenario. No blanket 0–2-call claim is made until LM-04, LM-05, and LM-11 are implemented.
- [ ] Required regression tests pass, including "approach and ask", "walk then inspect", "search all morning under pressure 9", unknown creative attempt, private/forged references, and partial commit + retry.
- [ ] `npm run check` passes.

### Explicit non-goals

Do not redesign attribute/skill/check selection or mechanically complex operation inputs (LM-04), flatten NPC reasoning/extraction into one call (LM-05), change persistent-event materiality (LM-06), implement rolling summaries (LM-07), remove every model-driven stop/pressure decision (LM-11), or rewrite the narration system (LM-12). Those changes have their own tickets.

### Rollout / compatibility

Gate the new route temporarily if needed for comparison, but do not create two enduring gameplay architectures. Default to old-save readability: old `ActionRun` receipts and saved transcript data remain valid. If new segment identifiers must be persisted to support retries, explicitly version their schema and provide migration/read compatibility. Do not use temporary ephemeral segment numbering as the sole guarantee against duplicate commits after restart.

### Definition of done

A player's declaration is interpreted **once**, routed to a small set of registered and authorized capabilities, and resolved without model-led navigation of internal tools. Ordered compound actions survive, open-ended play remains possible, and later tickets can simplify mechanical input and NPC behavior without revisiting the routing contract.
