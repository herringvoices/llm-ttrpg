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

## Campaigns and saves

`initializeCampaignWorld` deep-clones campaign content into mutable World State. The campaign definition remains immutable source content.

`createSaveMetadata` records only the active component IDs and versions. `validateSaveMetadataForGame` rejects a save if any active component ID or version differs.

## Campaign planning ownership

The campaign-planning decision does not add a sixth `GameDefinition` component or change the completed issue #27 contracts.

- Immutable campaign content may eventually provide starting conflicts, situation seeds, secrets, NPC/faction agendas, themes, and optional initial planning guidance.
- The living high/medium/low campaign plan is hidden, mutable runtime/save state.
- Plan state is separate from authoritative World State/event history and from actor/group beliefs.
- Generic planning orchestration, validation, persistence/state, triggers, and context isolation belong to the engine.
- Presentation guidance may shape pacing and narrative emphasis but never truth.

Exact planner schemas and persistence are intentionally deferred to [issue #28](https://github.com/herringvoices/llm-ttrpg/issues/28). The implemented composition metadata will identify the game a save belongs to; later save payloads can additionally persist validated plan state without embedding it in immutable campaign source content.

## Intentionally deferred

There is no dynamic loader, plugin marketplace, mod SDK, SQLite implementation, LLM integration, campaign-planner runtime, real combat/progression system, desktop UI, or full Awakening Earth content in this slice.
