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

## Model prompt

Provider-neutral semantic input containing behavioral instructions, optional already-authorized context, semantic user/model conversation turns, and current input. Provider message roles and wire payloads are adapter concerns.

## Model runtime

The transport boundary that formats semantic prompts for a configured local provider and returns either text or a Zod-validated structured value with normalized diagnostics/failures. It is not a gameplay subsystem or mutation authority.

## Structured model output

A complete JSON value requested with an authoritative Zod schema. Provider-side JSON Schema constraints improve reliability; Zod validation after parsing determines whether the value is usable. Invalid output is never partially exposed or automatically repaired by a hidden retry.

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

## Simulation scope

A stable game-authored boundary for independently sleeping and catching up part of the world. A scope has a generic kind, may have a parent and explicit prerequisite scopes, and owns an authoritative simulation cursor. It is not automatically an entity or every container in the setting.

## World process

A versioned game-package definition that advances selected authoritative state across one complete elapsed fictional interval. It declares scope kinds, process dependencies, event interests, and scheduled-work ownership, then returns validated proposals rather than writing persistence directly.

## Wake closure

The smallest deterministic set of a requested simulation scope plus its parent and explicit prerequisite scopes. Catch-up wakes this closure in dependency order without automatically waking descendants, siblings, or unrelated systems.

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

## Persistent simulation actor

An identified person whose individual goals, relationships, memories, commitments, knowledge, obligations, or other durable state matter enough to persist and participate in later simulation.

Persistent social state does not imply a complete mechanical character sheet.

## Actor social state

Generic authoritative state for one persistent actor's durable goals, directed relationships, episodic memories, and commitments. Identity/world facts remain ordinary entity/fact state, knowledge uses actor/group beliefs, and rules mechanics remain separate.

## Mechanical realization

The degree to which an entity's exact rules representation has been authoritatively instantiated.

The ladder is:

- **unrealized** — no exact rules profile is needed yet
- **constrained** — canonical fiction establishes mechanical bounds/requirements without exact values
- **partial** — only the mechanics currently required have been realized
- **complete** — the active ruleset/adapter has no missing required fields for the entity's currently supported mechanical model

Mechanical realization is independent of world/social resolution.

## Mechanical densification

Demand-driven movement toward a more specific mechanical realization state. Densification adds only necessary rules detail unless a complete profile is explicitly required and may never contradict prior authoritative facts, mechanics, observations, or outcomes.

## Creature concept

The authoritative fictional description that constrains a generated creature before or alongside exact rules values: origin, ancestry where applicable, morphology, scale, locomotion, senses, behavior/intelligence, ecology, survival/growth history, supernatural traits, observed effects, and death/loot implications.

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

## Creature archetype

A reusable setting/campaign definition for a recognizable kind of monster, including its coherent supernatural principle, morphology ranges, behavior/ecology, capability ranges, signature ability family, tells/counterplay, and growth tendencies.

## Creature instance

One concrete monster in authoritative World State. It may reference an archetype while retaining its own origin/history, size, growth state, conditions, location, mechanical realization, variations, and observations.

## Threat envelope

A durable package-owned constraint over a creature's intended capability range, such as offensive pressure, survivability, mobility, control, multi-target/resource pressure, hard-counter risks, signature capabilities, tells/counterplay, and allowed growth.

It is established before or alongside exact mechanical realization and prevents later densification from secretly scaling an existing monster to the current party.

## Party capability snapshot

A structured picture of the expected active group's relevant progression, Attributes, Skills, Powers, equipment/resources, size, synergies, gaps, and established preparation used when deliberately generating/auditing new player-targeted challenge content.

Character Level is one input rather than the whole difficulty metric.

## Challenge band

A non-authoritative design/audit target for a direct confrontation:

- **Routine** — reliably manageable with little lasting cost
- **Challenging** — party favored but meaningful decisions/resources matter
- **Hard** — substantial danger; poor play/bad luck can take someone out
- **Severe** — victory plausible but defeat/retreat is a serious outcome
- **Overwhelming** — direct victory is not the expected fair solution; survival/escape/preparation/etc. is the challenge

Challenge bands do not set XP and are not necessarily visible in-world.

## Challenge audit

A pre-commit evaluation of deliberately generated player-targeted monster content. It checks affectability, threat, decision quality, counterplay, hard counters, durability/tempo, party-size pressure, resources, escape/alternate approaches, and fictional coherence, using real rules-grounded scenario probes where practical.

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

## Provisional detail

Protected GM-facing detail proposed inside genuinely undefined space but not yet committed to authoritative World State, event history, actor knowledge, or social state. It may be revised or discarded until it crosses a commitment boundary.

## Commitment boundary

The point at which provisional persistent detail must be validated and committed through ordinary authoritative mechanisms before it can be observed, used causally by an actor or simulation process, establish durable knowledge/belief, or support another canonical consequence. After commitment, ordinary no-retcon rules apply.

## Situation candidate

A non-authoritative GM-facing framing of grounded circumstances that may deserve attention. It may reference canonical facts, actors, pressures, processes, goals, events, and explicitly provisional details. A situation candidate is planning/content material, not a competing World State object and not a promise that any future development will occur.

## Discovery affordance

A grounded, perspective-safe way a situation may come into view, such as direct observation, conversation, a public notice, an environmental change, institutional contact, or a rumor held by an appropriate actor/group. Persistent detail required by the affordance must cross the commitment boundary before the affordance is surfaced.

## Situation realization

The reference-game integration step that converts a grounded non-authoritative situation/opening brief into schema-validated proposed entities, facts, creatures, processes, and events, then commits only the required authoritative detail before it can be perceived or used causally. Model output is proposal material; validation and commit establish truth.

## Magical interaction barrier

Awakening Earth's setting-adapter rule that ordinary mundane force cannot directly alter or injure intrinsically magical structure in the first playable slice. The barrier is effect-specific rather than blanket immunity to physics: displacement, restraint, environmental consequences, and other non-injury effects remain independently resolvable.

## Ambient contact empowerment

Awakening Earth's ordinary property by which an awakened actor's body and a mundane object they are directly and intentionally wielding can interact magically while direct contact is part of the action. It is not a permanent enchantment and ordinary released projectiles do not retain it for normal ranged impact.

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
