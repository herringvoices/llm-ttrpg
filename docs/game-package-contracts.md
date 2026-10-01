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
- discovery/category metadata
- Zod input and result schemas
- a deterministic implementation

`executeRulesOperation` validates both sides of the call. Operations return a result plus proposed mutations/events; they do not write storage or mutate authoritative state directly.

Each operation also returns an exact nonnegative fictional-time duration. The runtime applies mutations, advances the fictional clock, validates package-owned event payloads, assigns sequence/order and source-component metadata, and atomically commits state plus newly meaningful events. Wall-clock metadata is supplied through a separate `wallClock` dependency.

Rulesets, settings, adapters, and campaigns may register versioned event-type definitions containing a stable type, schema version, and Zod payload schema. `loadGameDefinition` combines these into an event registry and rejects duplicate or malformed definitions. The engine persists the generic event envelope and opaque JSON payload; the owning package retains mechanical meaning.

## Campaigns and saves

`initializeCampaignWorld` deep-clones campaign content into mutable World State. Authored campaign events separately seed canonical history in deterministic fictional-time/array order. The campaign definition remains immutable source content.

`createSaveMetadata` preserves issue #27's small compatibility envelope, recording the active component IDs and versions. `validateSaveMetadataForGame` rejects it if any component differs. The persistence runtime validates composition directly and does not treat the legacy `saveId` field as a world ID or as proof that a world can have only one save.

Issue #5 adds persistence around those contracts without changing the five-part game composition. A world is a persistent lineage with its own opaque identity and current revision. Issue #6 separates current state from append-only event history. Each immutable checkpoint records its world, optional parent checkpoint, exact game composition, state revision, event-sequence head, relational state snapshot, and separate exact history snapshot. A named save slot has a separate stable identity and points to one checkpoint; saving again creates a successor checkpoint and moves the slot.

The engine defines cohesive persistence capabilities for world lifecycle/atomic commits, checkpoint/save-slot operations, generic current-content queries, and targeted event-history queries. `createGameRuntime({ persistence, wallClock, idGenerator, game })` owns the `validate -> apply -> persist -> expose` boundary. The desktop provides the SQLite implementation; headless tests use the in-memory implementation.

The SQLite model is deliberately coarse and generic: worlds, checkpoints, save slots, entities, facts, append-only events, beliefs, documents, document sections, scheduled triggers, and simulation cursors. Flexible values remain JSON. No ruleset-specific mechanic tables are part of this contract. Ordinary commits append new events instead of rewriting historical rows; checkpoints copy history into an immutable checkpoint scope so future divergence remains possible without a timeline UI.

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
