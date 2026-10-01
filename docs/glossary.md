# Glossary

## Action pressure

Persisted authoritative simulation/control state representing how finely player intent may be resolved right now. The level is assessed by the LLM from current fictional circumstances, validated and stored by the engine, and mapped deterministically to a maximum resolution horizon.

Action pressure is explicitly unassessed until an assessment is accepted. It is not fictional truth, a combat flag, a difficulty rating, or a deterministic derivation from world facts. Changing it does not by itself create a canonical event.

Low pressure allows broad intentions spanning long fictional time. High pressure restricts execution to immediate attempts. Pressure constrains the fictional resolution horizon, not the number of engine operations.

## Active scene

The currently relevant people, places, objects, constraints, and events that should be available to the action-resolution loop.

## Authoritative state

Canonical game truth owned by the deterministic simulation and persisted state, rather than invented directly by the LLM.

## Catch-up

Advancing a sleeping/off-screen system from its last simulated fictional time to the current relevant time when that system becomes relevant again.

## Context assembly

Building the LLM's working context from the small always-present rules layer plus selectively retrieved world facts, memories, events, and tools.

## Executable intent

A validated, bounded form of interpreted intent. It preserves the actor, goal, and relevant targets while recording the requested horizon, accepted pressure level, authorized horizon, and whether the request was narrowed.

The authorized horizon is a ceiling on downstream execution, not automatic fictional-time advancement. An over-broad declaration remains an attempt toward the same goal rather than being textually chopped into a different action.

## Material circumstance change

A canonical development that invalidates assumptions under which the remaining executable intent was authorized, or creates a meaningful new choice that should be returned to the player. Downstream orchestration relinquishes control instead of blindly consuming the remaining authorized horizon.

## Meaningful event

A persisted occurrence that may durably matter to future causal resolution, lazy simulation, actor/world knowledge, historical retrieval, campaign-planning triggers, meaningful narration, or diagnostics. Event history is selective and append-only, not a record of every low-level mutation and not an event-sourcing mechanism for rebuilding current state.

## Fictional instant

A normalized UTC ISO timestamp on the world's internal timeline. It is independent of wall-clock metadata and may be rendered through a setting-specific calendar later.

## Fictional duration

An exact nonnegative integer number of milliseconds used for deterministic advancement of fictional time. Zero is a legal no-op; negative advancement is invalid.

## Scheduled trigger

Persisted future engine work that may later resolve into state changes or meaningful events. A trigger records what should be evaluated, not an assertion that its possible outcome has already happened.

## Simulation cursor

The last fictional instant at which a generic simulation scope was brought current. A cursor may not be later than the world's fictional time.

## Operation

A deterministic engine capability exposed to the LLM-facing orchestration layer, such as observing a location, attempting movement, modifying an object through validated rules, or querying relevant knowledge.

## Sleeping system

A region, town, building, NPC, organization, economy, or other simulation subsystem that is not continuously ticking while irrelevant.

## Tool tree

The hierarchical catalog the orchestration layer uses to discover engine capabilities progressively.

The hierarchy is at least **domain → subsystem → operation**. It is MCP-like conceptually but is local application architecture, not a set of literal MCP servers.

## World event history

The separately persisted causal record of meaningful occurrences. Events carry fictional time, deterministic sequence, related entities/scopes, backward causal links, execution provenance, explicit access, source-package identity/version, and a package-validated payload. History helps catch-up systems and targeted retrieval without being embedded in current World State.

## Ruleset

A versioned package boundary that defines mechanics and discoverable deterministic rules operations. It does not define the fictional world in which those mechanics are used.

## Setting

A versioned package boundary that defines reusable fictional reality: history, geography, cultures, institutions, ontology, public facts, and hidden canonical truths.

## Setting adapter

A versioned, pair-specific bridge that maps concepts from exactly one setting to mechanics in exactly one ruleset. It is not a second rules engine.

## Campaign

Authored starting content for a particular playable instance. Campaign content initializes mutable World State and is not itself mutated during play.

## Presentation configuration

Non-authoritative narration, terminology, formatting, and UI guidance. It may change how an event is described but never what happened.

## Game definition

The explicit composition of one ruleset, setting, compatible setting adapter, campaign, and presentation configuration. Saves record the stable IDs and versions of this composition.

## World

A persistent campaign/world lineage with an opaque stable identity, current canonical state, and zero or more saves. A display name is not canonical identity.

## Checkpoint

An immutable snapshot of a world's canonical current state, exact game composition, and separate event-history view at one committed state revision/event-sequence head. A checkpoint may identify a parent checkpoint, allowing later divergence without rewriting history.

## Save slot

A friendly named pointer to a checkpoint. Saving to an existing slot creates a new immutable checkpoint and moves the pointer; it never mutates the old checkpoint.

## Campaign plan

Hidden, persisted, non-authoritative GM state that tracks revisable campaign direction. It can guide attention, pacing, and context selection, but it cannot establish events, mutate World State, or force player/NPC actions.

## Planning horizon

One of three linked scopes within a campaign plan:

- **high-level** — long-running conflicts, themes, faction agendas, mysteries, arcs, and possible end states
- **medium-level** — the current adventure/arc, developing situations, revelations, faction moves, and consequences likely to matter over coming days/sessions/locations
- **low-level** — near-term tensions, accessible clues/opportunities, callbacks, complications, and likely-relevant NPC actions for the next few scenes

## Narrative thread

A developing conflict, mystery, goal, relationship, pressure, opportunity, or consequence that may receive future attention. A thread is not a promise that any event will occur.

## Replanning

Revising the living campaign plan after meaningful developments. Replanning begins at the lowest affected horizon and expands upward only when the current campaign direction has genuinely changed.

## Planning trigger

A lightweight signal that recorded developments may require targeted replanning, such as a major player decision, changed NPC allegiance, faction success/failure, revelation, large time jump, exhausted plan, or contradiction between plan assumptions and current state.
