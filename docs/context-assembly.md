# Context Assembly and Knowledge Retrieval

Issue #10 implements a disposable, perspective-aware context layer between the authoritative simulation and a future model runtime. It produces structured data; it does not own prompt-provider syntax or decide which game action to execute.

## Three layers

Every context package separates:

1. **Bootstrap** - compact authority rules, exact active game composition, model role, knowledge perspective, and the progressive-discovery protocol.
2. **Situation** - current fictional time, action pressure and maximum horizon, a safely projected executable intent when present, interaction-local working references, and a fresh scene manifest.
3. **Retrieved material** - focused facts, beliefs, event history, documents, scene details, plan fragments, or other validated items requested for the current task.

Omission never means that a thing is false or nonexistent. It means only that it was not provided in this package.

## Role, perspective, and identity

`ModelRole` describes the invocation's job: `actor`, `orchestrator`, `planner`, or `debug`. `KnowledgePerspective` separately identifies the actor/group whose awareness constrains the call, or canonical diagnostic access. Actor calls cannot use canonical perspective as an omniscience shortcut.

Scene providers are trusted game/application projections over current authoritative state. The engine validates their generic scene records, filters them by role and perspective, assigns context-local references, and never places raw canonical entity IDs in model-facing scene or intent data. A masked or unrecognized entity can therefore remain `masked figure` to an actor while diagnostics and private bindings retain its canonical linkage. Rebuilding after authoritative recognition changes may expose the recognized name.

The reference game owns its small `data.context` convention and supplies `referenceSceneSource`; the generic engine does not interpret its mechanics or lore. The desktop wires that provider into the headless runtime.

## Scene manifest

The scene manifest is derived for every assembly. It is not persisted and cannot compete with World State. It distinguishes prominent and ambient observations, active participants/interactions, conditions, and privileged latent elements. Interaction-local elements may remain relevant even when they are not purely spatial.

Latent orchestration entries record whether the focal actor is aware, whether identity is recognized, whether access is privileged, and whether discovery is available now, conditional, or currently unavailable. They may name a future discovery capability, but context assembly never fabricates a discovery result or hard-codes a game-specific perception mechanic.

Existence is cheaper than detail. Ambient entries contain a local reference, display identity, category, and only compact obvious state. Focused detail is supplied separately through an authorized local-reference projection. `createContextQueryExecutionOptions` rebuilds that private projection from the same current state/provider before an entity-detail query executes.

## Retrieval and tool discovery

The engine contributes one `knowledge` domain to the existing hierarchical catalog:

- `knowledge.world.inspect-entity`
- `knowledge.facts.retrieve`
- `knowledge.history.retrieve`
- `knowledge.documents.retrieve`

Each tool owns authoritative Zod input/output schemas and a private deterministic query binding. Engine query execution is asynchronous so bounded history can use the existing persistence port without copying history into World State. Actor history is restricted to public events; privileged roles may request GM-only events. Non-debug history queries require an entity, scope, type, origin, cause, or time filter and remain capped.

Facts preserve the existing public/hidden boundary. Actor/group beliefs omit engine-visible truth status. Document retrieval remains progressive: metadata, summary/index, one section, then full content. Contextual tool policies apply identically to listings, inspection, and direct binding, so guessing an unavailable tool ID does not bypass authorization.

## Budget, freshness, and diagnostics

Budgeting uses a deterministic provider-independent size unit (serialized character count for this slice). Authority/bootstrap, role/perspective, task, pressure/execution constraints, and required current anchors are retained even when that reports an over-budget package. Optional selection is stable: current interaction and task targets outrank prominent scene state, which outranks ambient minutia and broad retrieved material. Detail is removed before existence where practical.

Every included or omitted candidate has an inspectable decision. Provenance records source kind and IDs, package identity where supplied, and world revision. Retrieved projections carrying a different world revision are omitted as stale and must be refreshed. Assembled packages, summaries, local aliases, and working context are non-authoritative and disposable.

`renderContextForModel` intentionally excludes canonical diagnostic linkage. It retains safe source-kind markers (including `plan`) so non-authoritative planner material cannot masquerade as canonical truth. Full diagnostics are developer/orchestration data and must not be copied into actor prompts.

## Authority and issue boundaries

Assembly, retrieval, budget trimming, and rendering do not mutate World State, append events, advance time, consume RNG, change pressure, or alter beliefs. Issue #11 will choose and execute capabilities; #13 will define durable NPC memory/goals/relationships; #15 owns model transport and prompt formatting; #28 owns campaign-plan schemas, persistence, and replanning. #10 only provides the protected role/provenance seam through which later plan material may be supplied.
