# LM-10 — Source-driven foreground realization

## Runtime boundary

The generic engine owns the bounded `RealizationRequest`, `RealizationResult`, optional `ruleset.prepareRealization` hook and `GameSession.realize(request)`. A request records one kind, stable source identity, actor/perspective, scope, required fields, fictional time, validated trigger, idempotency key and a one-target/zero-or-one-model budget. A package without the hook responds `unavailable` without changing the world. Nothing runs on ambient description or a wall-clock tick.

A package preparer returns `already-sufficient`, `unavailable` or one registered operation and inputs; the engine never accepts arbitrary model mutations. The operation rechecks canonical source facts, generates a mutation batch, and the engine uses the existing optimistic-revision commit. Failed writes cannot leave a half-realized entity. Retried requests compare canonical state rather than relying on an ephemeral cache.

### LM-04 integration

The actual player-action pipeline receives LM-04's `missing-required-data` result and resolves at most two authorized `entity:<id>:mechanics` needs in the same turn before the roll. Only targets present in the validated action's actor/target IDs are eligible. The reference-game preparer provides the minimal baseline mechanics *required by its check* using the existing `rules.realization.realize-mechanics` operation. Known mechanics, inventory, powers, stress, statuses and source-linked threat-envelope constraints are not replaced. The realization has zero fictional duration and no random draw, and the action-run revision is committed along with the prerequisite. A failed or unsupported prerequisite stops the check, not declares a success. No new planner or LLM call is required.

Other rules packages choose their own realization policy or return unavailable. A game without any realizer does not acquire Awakening Earth stats from generic engine code.

### Source-linked people

Only a canonical **public `person.observed` fact** is a valid source. It supplies a scope, observation identity, bounded description and, when disclosed, a name. Ambient crowds remain statistical; identity requests cannot promote one. A deterministic ID is keyed to the source fact, not name spelling. First meaningful interaction can create a minimal ephemeral contact without mechanics or invented social state; subsequent identification and persistent engagement extend resolution history. A persistent contact receives an empty valid social-state container, not invented knowledge, goals or family ties. The existing source-checked person-promotion and no-retcon densification helpers are reused. Observation-source mappings survive saves within canonical entity data.

This patch provides the request/operation entry point **for an already committed person observation**. Automatically emitting those observation facts from arbitrary NPC dialogue is not part of this patch; that connection must be made only at an LM-06 material conversation boundary, not after each narrated bystander.

### Places and details

The existing registered `enter-local-place` operation realizes a room only on genuine entry. It checks canonical child/sibling identities and commits a stable parent fact, route fact and current-location fact. When a prior public `location.hint` supplies `name`, `summary` and parent scope, its source fact ID stays attached to the room. Two same-name places with distinct authored hints stay distinct. An unentered hint remains merely a fact, without an eagerly generated interior. Ordinary unlinked enter-local-place calls retain the old API and deterministic same-name behavior.

An `entity-detail` request can realize **one** missing field from a public `entity.detail.<data-key>` fact. No source fact, conflicting established value, or missing data key means no materialization. The registered one-field operation uses the pre-existing append-only densifier; a model cannot invent a power, route, historical private exit or NPC knowledge through it.

### Compatibility, boundaries, measurements

Existing full seed/world state is not rewritten or migrated. New identity aliases and location source IDs are derivable from canonical fact IDs plus entity data; no independent cache must survive reopen. Old materialized rooms and NPCs remain authoritative.

Time-based world process catch-up remains `catchUpScope`; it is **not** replaced or invoked from every realization request. The caller must catch up the relevant scope before asking for post-time-jump foreground specifics.

The scripted checks establish that zero additional model calls are needed for these deterministic realizations and verify retry/save invariants. They are not wall-clock benchmarks of a bundled LLM. LM-01 should record request counts, model invocations, prompt size, elapsed time and durable record growth; LM-13 should run long-play quality tests.

Outstanding integration that should not be overstated: promoting from free-text conversation requires an LM-06-grounded observation writer/registered social trigger; automatic proactive re-entry after time jumps requires the existing catch-up trigger to pass its updated snapshot before foreground realization. The core system is available to callers, and LM-04 preflight is the automatically wired case.
