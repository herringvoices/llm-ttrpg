# Game Package Contracts

Issue #27 establishes the smallest useful seam between the game-agnostic engine and the first reference game.

## Package layout

- `packages/engine` defines generic contracts, validation, operation discovery/execution, content retrieval, campaign initialization, and save-composition checks.
- `packages/reference-game` implements the first reference composition through explicit `ruleset`, `setting`, `adapter`, `campaign`, and `presentation` modules.

These reference-game layers deliberately remain modules in one workspace package. They are not independently published plugins.

## Composition and validation

`loadGameDefinition` is the runtime load boundary. It validates:

- stable component IDs and semantic versions
- unique component, content, mapping, and operation IDs
- exact adapter compatibility with its ruleset/setting pair
- campaign compatibility with the selected setting
- content schemas and referential integrity
- adapter references to setting concepts and rules operations

The returned `LoadedGameDefinition` includes the authoritative operation/event registries, validated world-simulation registry, a separately composed model-facing tool catalog, and the exact versioned composition recorded by saves.

Rulesets, settings, adapters, and campaigns may contribute generic simulation scopes and world processes through their existing component identity/version. Concrete scope topology commonly belongs to a campaign, while reusable elapsed behavior may live with the package that owns its meaning. The engine combines active contributions, validates scope/process dependency DAGs and scope-kind compatibility, and rejects ambiguous scheduled-work handlers. This does not add another game-definition component or a public plugin SDK. See [Lazy World Simulation and Catch-Up](lazy-world-simulation.md).

## Content and knowledge

The generic content model supports entities, canonical facts/events, actor/group beliefs, and long-form documents. Canonical facts have public or hidden visibility. Beliefs have an engine-visible truth assessment (`true`, `incomplete`, `uncertain`, or `false`) but actor-facing retrieval deliberately omits that assessment so an actor is not told that its own belief is wrong.

`retrieveKnowledge` filters canonical facts by perspective and returns only the selected actor/group's beliefs. `retrieveDocument` supports metadata, summary/section index, one section, or full-document retrieval.

## Rules operations

Rulesets register operations under `domain -> subsystem -> operation`. Every operation supplies:

- a stable operation ID and description
- an `ordinary` or `resolution` kind
- discovery/category metadata
- Zod input and result schemas
- a deterministic implementation

`executeRulesOperation` validates both sides of the call. Operations return a result plus proposed mutations/events; they do not write storage or mutate authoritative state directly.

Each operation also returns an exact nonnegative fictional-time duration. The runtime applies mutations, advances the fictional clock, validates package-owned event payloads, assigns sequence/order and source-component metadata, and atomically commits state plus newly meaningful events. Wall-clock metadata is supplied through a separate `wallClock` dependency.

Rulesets, settings, adapters, and campaigns may register versioned event-type definitions containing a stable type, schema version, and Zod payload schema. `loadGameDefinition` combines these into an event registry and rejects duplicate or malformed definitions. The engine persists the generic event envelope and opaque JSON payload; the owning package retains mechanical meaning.

## Hierarchical tool catalog

The tool catalog is not the operation registry. The operation registry is complete executable backend infrastructure containing rules implementations and authoritative runtime schemas. The catalog is a progressively disclosed, availability-filtered projection that orchestration can navigate without placing every capability schema in model context.

Discovery is stateless and deterministic:

1. list domains with explicit authored descriptions
2. list one domain's subsystems
3. list concise tool summaries for one subsystem
4. inspect one tool's detailed invocation contract

Domain and subsystem metadata is contributed explicitly at composition time by the engine or active ruleset, setting, adapter, and campaign. Identical repeated metadata coalesces; conflicting descriptions, missing hierarchy references, and duplicate tool IDs fail composition. Empty contributions are valid. Core engine code contains no permanent list of game/tool namespaces.

Rules operations are projected from the existing `OperationRegistry`; the catalog does not copy their implementations or hand-maintain alternate schemas. Ordinary-operation and resolution-operation bindings retain their real operation IDs and kinds. Resolution inspection includes the bounded `ExecutableIntent`, and binding resolution produces the existing #8 `ResolutionRequest` rather than an execution shortcut. The #8 resolution contract owns the generic `ResolutionEnvelope` Zod schema factory and runtime validation; the catalog derives resolution-output documentation from that same schema rather than restating the envelope shape.

The first concrete selected ruleset now supplies its reusable attributes, open-ended skills, Performance/Resistance action resolution, Effect, stress/status, recovery, and learning-evidence operations through these opaque contracts. See [Reference Rules](reference-rules.md). The engine does not interpret any of those mechanics, while the pair-specific adapter may translate established setting concepts into validated ruleset inputs.

Deterministic read-only engine queries may contribute Zod input/output schemas plus a private query handler. They share the same model-facing catalog while remaining a distinct backend type and receive the same frozen rules-visible world view without private RNG progression. Query handlers may be asynchronous and may receive narrowly scoped read-only persistence services, such as bounded event-history access, plus #10 role/perspective authorization and private context-local reference maps. These services and handlers are never model-facing. Query input and output are validated by their authoritative Zod schemas.

Concise domain/subsystem/tool listings contain no schemas or implementation references. Individual inspection generates JSON-compatible input/output documentation from the authoritative Zod schemas. This representation guides the model; runtime Zod validation remains authoritative where JSON Schema cannot perfectly represent a Zod construct.

An availability predicate is applied consistently to listings, inspection, and private binding resolution. Availability is separate from disclosure history: an allowed registered tool can be addressed directly, but knowing an unavailable tool ID cannot bypass policy. Issue #10 now supplies role/perspective/situation-aware policy construction while retaining #9's same authorization point. Issue #11 will consume bindings for player-action planning/execution, and issue #15 will carry structured model requests without owning catalog authority.

## Context assembly and retrieval

The engine's [Context Assembly and Knowledge Retrieval](context-assembly.md) contracts create structured, disposable context packages. The bootstrap identifies the exact five-part game composition; the automatic frame is rebuilt from current World State; and selected retrieved items retain access, salience, derivation, provenance, and freshness metadata.

Scene content is supplied by a trusted game/application `SceneSourceProvider` that projects authoritative state into generic prominent, ambient, participant, condition, interaction, and latent records. This does not add a sixth game-definition component. The reference game's provider interprets its own opaque `data.context` convention, while the engine validates and access-filters the result. Presentation may affect descriptive emphasis but cannot create a scene fact.

The engine contributes progressive world detail, facts/beliefs, bounded event history, and document queries through the same hierarchical catalog. Actor-facing scene and intent projections use opaque context-local references instead of canonical entity IDs. Full diagnostic linkage remains private and is excluded from the model renderer. Working context is interaction-local and non-authoritative; it is not durable NPC memory.

### Resolution operations

There is no universal engine-level check. Checks, deterministic abilities, contests, card/resource mechanics, opposition, difficulty/modifier calculations, and degrees or axes of outcome belong to the owning ruleset. Resolution operations use the existing operation registry and expose ruleset-owned, JSON-compatible `basis`, prepared data, and result values that the engine validates but does not interpret.

A `ResolutionRequest` combines an already bounded `ExecutableIntent` with a resolution operation ID and structured input. Resolution is two-phase: deterministic assessment receives a deep-frozen rules-visible world view and no RNG capability, then selects `automatic`, `impossible`, or `uncertain`. The view is explicitly enumerated and omits engine-private RNG progression. Automatic and impossible paths return a complete outcome. Only uncertain resolution receives a lazy RNG capability, and it may still complete without drawing.

The owning ruleset validates that its structured input is applicable to the supplied executable intent—for example, whether a ruleset-defined actor field matches the intent actor. The engine does not infer semantics from arbitrary input fields.

`impossible` means the locally attempted operation cannot accomplish its intended effect under the current rules and conditions; it is a valid fictional resolution and may still consume time or cause consequences. It is distinct from malformed/invalid execution and does not determine that the player's overall goal is exhausted.

After a successful atomic commit, the runtime returns an envelope containing the executable intent, operation ID, generic path, opaque basis/result, exact duration, randomness trace or `null`, and canonical events. A single resolution is rejected if its duration exceeds the intent's authorized horizon. Multi-operation planning, cumulative budgeting, stopping, and pressure reassessment remain issue #11 responsibilities.

Operations cannot mutate the runtime candidate through context: ordinary and resolution operations receive cloned, recursively frozen rules-visible snapshots and must return validated mutation/event proposals. Uncertain resolution can access randomness only through its separate `rng` capability, never through the world view.

### Randomness

RNG progression is engine-owned simulation-control state. Each world persists the explicit algorithm (`mulberry32-v1`), an unsigned 32-bit root seed supplied through a host dependency, and the next local-stream index. Each stochastic resolution derives one deterministic local seed from the root seed and stream index; repeated draws remain within that stream.

Allocation is lazy and transactional. Invalid, automatic, impossible, and uncertain-without-draw paths do not consume a stream. If tentative RNG use is followed by validation or persistence failure, authoritative progression does not change. A successful stochastic commit increments the stream once and returns algorithm, stream, derived seed, and draw count for reproduction. Current worlds, save/reopen, and immutable checkpoints preserve this state. Migration `0004_resolution_randomness.sql` initializes pre-#8 worlds and checkpoints at seed `0`, stream `0`: this starts a deterministic future sequence and does not claim any preexisting RNG history.

## Action pressure and executable intent

Action pressure is a game-agnostic engine control contract, not a ruleset mechanic or a sixth game-package component. The eventual LLM-facing orchestration layer assesses a level from 1 through 9; the engine validates and atomically persists the accepted state, then applies the engine-owned maximum-resolution-horizon table deterministically.

New and migrated worlds remain explicitly unassessed until that assessment exists. Pressure is stored with mutable World State and captured by checkpoints because it controls execution scope across save/reopen, but it is not fictional truth and a pressure change is not automatically a canonical event.

The engine's interpreted-intent contract records an actor, unchanged goal, relevant targets, and requested fictional horizon. Pure intent bounding produces an executable intent whose authorized horizon is the lesser of the request and pressure maximum. That value is only a ceiling: downstream operation durations advance fictional time and consume the allowance. Pressure never limits operation count, rewrites the goal, or lets presentation/rules content bypass normal runtime persistence.

Multi-operation planning, remaining-budget accounting, material-change detection, and pressure-reassessment orchestration belong to issue #11. Game-specific checks and outcome semantics remain ruleset concerns under issue #8.

## Campaigns and saves

`initializeCampaignWorld` deep-clones campaign content into mutable World State. Authored campaign events separately seed canonical history in deterministic fictional-time/array order. The campaign definition remains immutable source content.

`createSaveMetadata` preserves issue #27's small compatibility envelope, recording the active component IDs and versions. `validateSaveMetadataForGame` rejects it if any component differs. The persistence runtime validates composition directly and does not treat the legacy `saveId` field as a world ID or as proof that a world can have only one save.

Issue #5 adds persistence around those contracts without changing the five-part game composition. A world is a persistent lineage with its own opaque identity and current revision. Issue #6 separates current state from append-only event history. Each immutable checkpoint records its world, optional parent checkpoint, exact game composition, state revision, event-sequence head, relational state snapshot, and separate exact history snapshot. A named save slot has a separate stable identity and points to one checkpoint; saving again creates a successor checkpoint and moves the slot.

The engine defines cohesive persistence capabilities for world lifecycle/atomic commits, checkpoint/save-slot operations, generic current-content queries, and targeted event-history queries. `createGameRuntime({ persistence, wallClock, idGenerator, worldSeedSource, game })` owns the `validate -> apply -> persist -> expose` boundary. The desktop provides the SQLite implementation; headless tests use the in-memory implementation.

The SQLite model is deliberately coarse and generic: worlds, checkpoints, save slots, entities, facts, append-only events, beliefs, documents, document sections, scheduled triggers, simulation cursors, action-pressure control state, and RNG control state. Flexible values remain JSON. No ruleset-specific mechanic tables are part of this contract. Ordinary commits append new events instead of rewriting historical rows; checkpoints copy history, pressure, and RNG progression into an immutable checkpoint scope so future divergence remains possible without a timeline UI. A deliberate world-deletion command may atomically remove an entire campaign lineage, including its immutable rows, without weakening those protections for ordinary runtime operations.

The official Tauri SQL JavaScript API does not expose a connection-bound transaction callback. The adapter therefore submits each logical write as one insert into a private command table; a migration-owned SQLite trigger expands that command into the relational tables within the same SQLite statement. Revision/composition guards abort the statement before any partial state is exposed. This keeps transaction semantics in SQLite without creating a custom Rust repository layer.

## Campaign planning ownership

The campaign-planning decision does not add a sixth `GameDefinition` component or change the completed issue #27 contracts.

- Immutable campaign content may eventually provide starting conflicts, situation seeds, secrets, NPC/faction agendas, themes, and optional initial planning guidance.
- The living high/medium/low campaign plan is hidden, mutable runtime/save state.
- Plan state is separate from authoritative World State/event history and from actor/group beliefs.
- Generic planning orchestration, validation, persistence/state, triggers, and context isolation belong to the engine.
- Presentation owns a validated, versioned Narration Profile. Its deterministically compiled guidance is protected on every player-facing LLM prose request and may shape pacing, voice, and narrative emphasis but never truth. See [Narration & Presentation](narration-presentation.md).

The engine now implements the planner schemas and dedicated persistence boundary from [issue #28](https://github.com/herringvoices/llm-ttrpg/issues/28). Composition metadata identifies the game a save belongs to, while checkpoint payloads snapshot validated living plan state without embedding it in immutable campaign source content.

## Intentionally deferred

There is no dynamic loader, plugin marketplace, mod SDK, sophisticated autonomous campaign director, sophisticated desktop UI, or complete Awakening Earth campaign/region content in this slice. Context assembly deliberately uses deterministic size units rather than a provider tokenizer and deterministic structured retrieval rather than embeddings/vector search.

## Local model transport

The provider-neutral [Local Model Runtime](model-runtime.md) is game-agnostic infrastructure and is not a sixth `GameDefinition` component. It accepts semantic prompt ingredients plus text or Zod-validated structured output contracts. Desktop provider adapters own provider messages/HTTP; browser development uses configured Ollama, while shipping builds use the Tauri-managed bundled llama.cpp runtime. Switching game composition and switching inference providers remain independent decisions.

Model output cannot mutate package content or World State. A later orchestration layer must still resolve a validated structured selection through the authoritative catalog/runtime paths. Provider-native tool calls, prompt token counts, streaming chunks, and runtime lifecycle observations have no canonical authority.
