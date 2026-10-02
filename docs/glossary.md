# Glossary

## Action pressure

Persisted authoritative simulation/control state representing how finely player intent may be resolved right now. The level is assessed by the LLM from current fictional circumstances, validated and stored by the engine, and mapped deterministically to a maximum resolution horizon.

Action pressure is explicitly unassessed until an assessment is accepted. It is not fictional truth, a combat flag, a difficulty rating, or a deterministic derivation from world facts. Changing it does not by itself create a canonical event.

Low pressure allows broad intentions spanning long fictional time. High pressure restricts execution to immediate attempts. Pressure constrains the fictional resolution horizon, not the number of engine operations.

## Active scene

The interaction-local people, places, objects, conditions, constraints, and commitments relevant to the current moment. It is not only a spatial radius.

## Scene manifest

A compact, freshly derived model-facing projection of the active scene. It distinguishes prominent, ambient, participating, interacting, condition, and privileged latent elements without persisting a competing scene database.

## Authoritative state

Canonical game truth owned by the deterministic simulation and persisted state, rather than invented directly by the LLM.

## Catch-up

Advancing a sleeping/off-screen system from its last simulated fictional time to the current relevant time when that system becomes relevant again.

## Context assembly

Building a structured, disposable model context from a tiny authority/composition bootstrap, a fresh automatic situation frame, and selectively retrieved facts, beliefs, events, documents, scene details, plan fragments, and tool descriptions.

## Context-local reference

An opaque alias assigned inside one context package that lets a model refer to an entity without revealing its canonical identity. Private diagnostics/bindings retain the authoritative linkage.

## Model role

The job performed by a model invocation: actor reasoning, scene orchestration, protected campaign planning, or developer diagnostics. Role controls capability/access policy but is distinct from whose knowledge constrains the call.

## Knowledge perspective

The actor, group, or canonical diagnostic viewpoint that constrains available facts, beliefs, recognition, and identity. Role and perspective are separate: an orchestrator may know tightly scoped hidden scene truth that its focal actor does not.

## Working context

Disposable interaction-local continuity such as a conversation partner, inspected object, recent referents, or local aliases. It may span nearby calls but is neither canonical World State nor durable NPC memory.

## Context budget

A deterministic size ceiling used to prioritize required current constraints, prominent/task-relevant material, ambient existence, and retrieved detail. A budget is not an authority rule and never lets omitted material become false.

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

An operation is either ordinary or resolution-capable. Both kinds use the same progressively disclosed tool tree, receive an explicitly bounded rules-visible world view without engine-private RNG progression, and return validated proposals rather than mutating authoritative state directly.

## Resolution

Engine execution of a ruleset-owned mechanic for an already bounded `ExecutableIntent`. Resolution is more general than a check: it can represent deterministic abilities, contests, cards, resources, randomness, or mechanics with no familiar success/failure model.

## Resolution operation

A rules operation with a deterministic, RNG-free assessment phase and an optional uncertain execution phase. Its structured basis, prepared data, and result are validated but mechanically opaque to the engine.

## Resolution path

One of three generic classifications chosen by resolution assessment:

- **automatic** — the ruleset can complete the operation without uncertainty
- **impossible** — this coherent local attempt cannot accomplish its intended effect under current rules/conditions, though attempting it may still have consequences
- **uncertain** — authoritative ruleset resolution is required and may, but need not, use RNG

These paths are not universal success/failure outcomes. In particular, `impossible` is neither an invalid request nor a conclusion that the player's overall goal is impossible.

## Resolution envelope

The post-commit record returned for narration and diagnostics: executable intent, operation ID, resolution path, opaque ruleset basis/result, exact fictional duration, randomness trace or `null`, and produced canonical events.

## Performance

The selected reference ruleset's exact numeric capability for one attempted approach after relevant attributes are modified and averaged, the strongest applicable skill is applied, and broader circumstances, assistance, status, and stress modifiers are included. It is rules-owned opaque data, not an engine concept.

## Resistance

The selected reference ruleset's opposition to Performance. It is either fixed with direct/authored/benchmark provenance or produced by another actor through the same Performance rules. A tie does not overcome Resistance.

## Potential Effect

The pre-resolution magnitude from 1 through 3 that an attempted method can produce if successful. It follows from fictional method and scope, not capability, margin, or luck, and supplies the basis for uncertain-check skill SP.

## Realized Effect

The actual magnitude from 0 through 3 produced after resolution. Failure realizes 0. Successful Effect may be contextually fixed, deterministically derived, or independently checked, and cannot exceed Potential Effect.

## Stress

Transient functional pressure on one of the selected ruleset's Injury, Fear, Anger, Exhaustion, or Insecurity tracks. Each point applies -5% overall Performance, capped at -70% across tracks; a track reaching 5 means Taken Out. Stress is distinct from persistent statuses/injuries.

## Taken Out

A structured rules result indicating that one stress track reached 5 and the actor cannot continue normally in that dimension. The fiction determines surrender, flight, incapacity, emotional loss of control, or another contextual consequence. A normally fatal PC result still requires explicit player consent.

## Skill specificity

An authored semantic breadth band intrinsic to an open-ended skill: broad field (1), major subdomain (2), focused discipline (3), or specialization (4). Orchestration proposes and semantically reviews it; deterministic rules validate the 1–4 bound and use it in the skill contribution formula.

## Invalid resolution request

A request that fails an execution boundary, such as malformed input, an unknown or wrong-kind operation, an illegal reference, invalid output/proposals, or an engine-owned constraint violation. It commits no state, time, event, or RNG progression.

## Randomness state

Persisted authoritative simulation-control state consisting of a versioned algorithm, world root seed, and next local-stream index. It is not fictional truth. Checkpoints preserve the exact progression, and world seeds come from an explicit host dependency rather than wall-clock time.

## Randomness trace

Reproduction metadata for one completed stochastic resolution: algorithm, local stream index, derived seed, and draw count. A resolution that does not draw has no trace and consumes no stream.

## Sleeping system

A region, town, building, NPC, organization, economy, or other simulation subsystem that is not continuously ticking while irrelevant.

## Tool tree

The hierarchical catalog the orchestration layer uses to discover engine capabilities progressively.

The disclosure hierarchy is **domain → subsystem → concise tool → detailed tool contract**. It is MCP-like conceptually but is local application architecture, not a set of literal MCP servers.

## Tool catalog

A stateless, model-facing projection over registered deterministic capabilities. It provides explicit hierarchy descriptions, concise listings, per-tool schema documentation, contextual availability filtering, and private bindings back to authoritative backends. It is not the rules-operation registry and can also describe deterministic engine queries.

Potential catalog entries are composed with the active game. The currently visible entries may be filtered by a replaceable availability policy. Whether a tool was previously disclosed has no authority significance.

## Tool contract

The detailed model-facing documentation for one catalog tool, including its stable identity, hierarchy/provenance, and JSON-compatible input/output schemas generated from authoritative Zod validators. It never contains executable callbacks or private engine state.

## Tool binding

The engine-private connection from a registered catalog tool to its real backend: an ordinary rules operation, a resolution operation using the bounded #8 request path, or a validated deterministic engine query. A binding is not serialized into model context.

## Tool availability policy

A replaceable predicate that decides whether a registered tool is currently available. The same decision governs listings, detailed inspection, and binding resolution. Context assembly supplies current model-role, knowledge-perspective, and situation inputs without moving those semantics into the low-level catalog.

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
