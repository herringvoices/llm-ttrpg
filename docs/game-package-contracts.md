# Game Package Contracts

Issue #27 establishes the smallest useful seam between the game-agnostic engine and the first reference game.

## Package layout

- `packages/engine` defines generic contracts, validation, operation discovery/execution, content retrieval, campaign initialization, and save-composition checks.
- `packages/reference-game` implements one tiny example through explicit `ruleset`, `setting`, `adapter`, `campaign`, and `presentation` modules.

These reference-game layers deliberately remain modules in one workspace package. They are not independently published plugins.

## Composition and validation

`loadGameDefinition` is the runtime load boundary. It validates:

- stable component IDs and semantic versions
- unique component, content, mapping, and operation IDs
- exact adapter compatibility with its ruleset/setting pair
- campaign compatibility with the selected setting
- content schemas and referential integrity
- adapter references to setting concepts and rules operations

The returned `LoadedGameDefinition` includes a progressively discoverable operation registry and the exact versioned composition recorded by saves.

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

The SQLite model is deliberately coarse and generic: worlds, checkpoints, save slots, entities, facts, append-only events, beliefs, documents, document sections, scheduled triggers, simulation cursors, action-pressure control state, and RNG control state. Flexible values remain JSON. No ruleset-specific mechanic tables are part of this contract. Ordinary commits append new events instead of rewriting historical rows; checkpoints copy history, pressure, and RNG progression into an immutable checkpoint scope so future divergence remains possible without a timeline UI.

The official Tauri SQL JavaScript API does not expose a connection-bound transaction callback. The adapter therefore submits each logical write as one insert into a private command table; a migration-owned SQLite trigger expands that command into the relational tables within the same SQLite statement. Revision/composition guards abort the statement before any partial state is exposed. This keeps transaction semantics in SQLite without creating a custom Rust repository layer.

## Campaign planning ownership

The campaign-planning decision does not add a sixth `GameDefinition` component or change the completed issue #27 contracts.

- Immutable campaign content may eventually provide starting conflicts, situation seeds, secrets, NPC/faction agendas, themes, and optional initial planning guidance.
- The living high/medium/low campaign plan is hidden, mutable runtime/save state.
- Plan state is separate from authoritative World State/event history and from actor/group beliefs.
- Generic planning orchestration, validation, persistence/state, triggers, and context isolation belong to the engine.
- Presentation guidance may shape pacing and narrative emphasis but never truth.

Exact planner schemas and persistence are intentionally deferred to [issue #28](https://github.com/herringvoices/llm-ttrpg/issues/28). The implemented composition metadata will identify the game a save belongs to; later save payloads can additionally persist validated plan state without embedding it in immutable campaign source content.

## Intentionally deferred

There is no dynamic loader, plugin marketplace, mod SDK, LLM integration, campaign-planner runtime, real combat/progression system, sophisticated desktop UI, or full Awakening Earth content in this slice.
